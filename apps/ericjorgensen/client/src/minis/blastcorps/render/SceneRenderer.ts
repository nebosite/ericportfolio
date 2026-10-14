import * as THREE from "three";
import { MATERIALS } from "../sim/materials";
import {
  EVENTS_OFFSET,
  Header,
  MAX_WHEELS,
  MaterialKind,
  PARTS_OFFSET,
  VEHICLE_OFFSET,
  VISUAL_FLOATS,
  wheelOffset,
  type StructureInfo,
  type VehicleKind,
} from "../sim/protocol";
import { VEHICLE_SPECS } from "../sim/Vehicle";
import { Effects } from "./Effects";
import { PartsMesh, type PartVisual } from "./PartsMesh";
import { HIDDEN_PIP, pipVisible, updatePip, type PipState } from "./pip";
import { VehicleModel } from "./VehicleModel";

// three.js view of a snapshot. Every structural part is an instance of one
// PartsMesh (one draw call, posed on the GPU from the snapshot's pose array),
// the vehicle is a VehicleModel posed straight from the physics, and the follow
// camera keeps the vehicle and the next unfelled structure ahead in frame,
// widening with speed and shaking with violence. A second, cab-mounted camera
// renders the driver's view of the struck structure into a corner while a
// strike is under way.

const CAMERA_BACK = 12;
const CAMERA_UP = 5;
const CAMERA_LAG_S = 0.25;
const LOOK_TOWARD_FOCUS = 0.35;
const SHAKE_DECAY_S = 0.3;
const SHAKE_MAX_DEG = 4;
const FOV = 65;
const FOV_AT_SPEED = 78;
const BACK_AT_SPEED = 1.25; // × CAMERA_BACK at top speed
const PIP_FOV = 55;
/** Strike onset: hold the view this long so the contact registers (a hit-stop). */
const HIT_STOP_S = 0.07;
/** A structure past this demolition fraction no longer draws the camera's attention. */
const FELLED = 0.5;

export class SceneRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly pipCamera: THREE.PerspectiveCamera;
  private readonly sun: THREE.DirectionalLight;
  private parts: PartsMesh | null = null;
  private structures: StructureInfo[] = [];
  private demolition: number[] = [];
  private vehicle: VehicleModel | null = null;
  readonly effects: Effects;
  private readonly vehiclePos = new THREE.Vector3();
  private readonly vehicleQuat = new THREE.Quaternion();
  private readonly focus = new THREE.Vector3();
  private readonly cameraPos = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private readonly pipTarget = new THREE.Vector3();
  private shake = 0;
  private fovPunch = 0;
  private holdUntil = -Infinity;
  private speedFraction = 0;
  private cameraInitialised = false;
  private pip: PipState = HIDDEN_PIP;
  private width = 1;
  private height = 1;
  // Scratch
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly lighting = {
    sunDir: new THREE.Vector3(0.5, 0.8, 0.3),
    sunColor: new THREE.Color(0xfff1d6).multiplyScalar(1.1),
    skyColor: new THREE.Color(0xbfd4ee).multiplyScalar(0.6),
    groundColor: new THREE.Color(0x4a4238).multiplyScalar(0.6),
    fogColor: new THREE.Color(0x8fb3d9),
    fogNear: 300,
    fogFar: 1400,
  };

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.autoClear = false;

    this.scene.background = this.lighting.fogColor;
    this.scene.fog = new THREE.Fog(
      this.lighting.fogColor,
      this.lighting.fogNear,
      this.lighting.fogFar,
    );
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 2500);
    this.pipCamera = new THREE.PerspectiveCamera(PIP_FOV, 16 / 9, 0.5, 2500);

    this.scene.add(new THREE.HemisphereLight(0xbfd4ee, 0x4a4238, 0.7));
    this.sun = new THREE.DirectionalLight(0xfff1d6, 1.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const cam = this.sun.shadow.camera;
    cam.left = -60;
    cam.right = 60;
    cam.top = 60;
    cam.bottom = -60;
    cam.near = 1;
    cam.far = 400;
    this.sun.shadow.bias = -0.0008;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000),
      new THREE.MeshStandardMaterial({ color: 0x55584f, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    const grid = new THREE.GridHelper(2000, 200, 0x6e7268, 0x5e6159);
    grid.position.y = 0.02;
    this.scene.add(grid);
    this.effects = new Effects(this.scene);
  }

  /** Create the instanced parts and the vehicle body from the worker's static description. */
  setScene(
    visuals: Float32Array,
    partCount: number,
    structures: StructureInfo[],
    vehicle: VehicleKind,
  ): void {
    if (this.parts) {
      this.scene.remove(this.parts.mesh);
      this.parts.dispose();
    }
    const parts: PartVisual[] = [];
    for (let i = 0; i < partCount; i++) {
      const o = i * VISUAL_FLOATS;
      const kind = visuals[o + 3] as MaterialKind;
      const base = MATERIALS[kind]?.color ?? MATERIALS[MaterialKind.Masonry].color;
      const v = 0.9 + 0.2 * hash(i); // per-part tonal variation
      parts.push({
        half: [visuals[o], visuals[o + 1], visuals[o + 2]],
        color: [base[0] * v, base[1] * v, base[2] * v],
      });
    }
    this.parts = new PartsMesh(parts, this.lighting);
    this.parts.setBuiltParts(0);
    this.scene.add(this.parts.mesh);
    this.structures = structures;
    this.demolition = structures.map(() => 0);
    if (!this.vehicle || this.vehicle.spec.kind !== vehicle) {
      if (this.vehicle) {
        this.scene.remove(this.vehicle.group);
        for (const w of this.vehicle.wheels) this.scene.remove(w);
      }
      this.vehicle = new VehicleModel(vehicle, this.scene);
    }
    this.pip = HIDDEN_PIP;
    this.cameraInitialised = false;
  }

  /** Per-structure demolition fractions (street order), for the camera's attention. */
  setDemolition(fractions: number[]): void {
    this.demolition = fractions;
  }

  /** The blade has just struck something at `strength` (0..1 of top speed). */
  strike(strength: number): void {
    this.fovPunch = Math.max(this.fovPunch, 3 + 5 * strength);
    this.shake = Math.min(SHAKE_MAX_DEG, this.shake + 1 + 2 * strength);
    this.holdUntil = performance.now() / 1000 + HIT_STOP_S * (0.5 + strength);
  }

  /** Pose everything from a snapshot (synchronously — the buffer is recycled after). */
  applySnapshot(snap: Float32Array, nowSeconds: number, dt: number): void {
    const events = snap.subarray(EVENTS_OFFSET);
    const breakCount = snap[Header.BreakCount];
    this.effects.onBreaks(events, breakCount, nowSeconds, snap[Header.Violence]);
    // Hit-stop: during the hold the world freezes for a few frames (the physics
    // keeps running; we just don't show it yet) so the contact reads.
    if (nowSeconds < this.holdUntil) return;
    const v = VEHICLE_OFFSET;
    this.vehiclePos.set(snap[v], snap[v + 1], snap[v + 2]);
    this.vehicleQuat.set(snap[v + 3], snap[v + 4], snap[v + 5], snap[v + 6]);
    if (this.vehicle) {
      this.vehicle.group.position.copy(this.vehiclePos);
      this.vehicle.group.quaternion.copy(this.vehicleQuat);
      for (let i = 0; i < MAX_WHEELS; i++) {
        const o = wheelOffset(i);
        const wheel = this.vehicle.wheels[i];
        if (!wheel.visible) continue;
        wheel.position.set(snap[o], snap[o + 1], snap[o + 2]);
        wheel.quaternion.set(snap[o + 3], snap[o + 4], snap[o + 5], snap[o + 6]);
      }
      this.speedFraction = Math.min(
        1,
        Math.abs(snap[Header.SpeedMps]) / this.vehicle.spec.topSpeed,
      );
    }
    if (this.parts) {
      this.parts.update(snap, PARTS_OFFSET);
      this.parts.setBuiltParts(snap[Header.BuiltParts]);
    }
    // Continuous violence (a collapse in progress) keeps the camera trembling.
    const violence = snap[Header.Violence];
    if (violence > 0.5) {
      this.shake = Math.min(SHAKE_MAX_DEG, this.shake + Math.min(1.5, violence * 0.02));
    }
    // Driver's-eye view: triggered by breaks near the vehicle; aimed at the struck structure.
    this.pip = updatePip(this.pip, nowSeconds, dt, events, breakCount, [
      this.vehiclePos.x,
      this.vehiclePos.y,
      this.vehiclePos.z,
    ]);
    if (breakCount > 0) {
      const struck = this.nearestStructure(this.pip.target[0], this.pip.target[2], null);
      if (struck)
        this.pipTarget.set(struck.center[0], Math.min(struck.height / 2, 40), struck.center[2]);
      else this.pipTarget.set(this.pip.target[0], this.pip.target[1], this.pip.target[2]);
    }
  }

  /** Advance the camera and draw (main view, then the driver's view if active). */
  render(dt: number, nowSeconds: number): void {
    this.updateFocus();
    this.updateCamera(dt);
    this.effects.update(nowSeconds, dt, this.height);
    this.renderer.setViewport(0, 0, this.width, this.height);
    this.renderer.setScissorTest(false);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (pipVisible(this.pip, nowSeconds)) this.renderPip();
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  /** Draw calls and triangles from the last frame. */
  get info(): { calls: number; triangles: number } {
    return {
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
    };
  }

  /** Unmasked GPU name when the browser allows it. */
  gpuName(): string {
    const gl = this.renderer.getContext();
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "unknown";
  }

  dispose(): void {
    this.renderer.dispose();
    this.parts?.dispose();
    this.effects.dispose();
  }

  private get cameraScale(): number {
    return this.vehicle?.cameraScale ?? 1;
  }

  /** Nearest structure to (x, z), optionally only ones ahead of the vehicle and not yet felled. */
  private nearestStructure(
    x: number,
    z: number,
    filter: ((s: StructureInfo, index: number) => boolean) | null,
  ): StructureInfo | null {
    let best: StructureInfo | null = null;
    let bestD = Infinity;
    this.structures.forEach((s, index) => {
      if (filter && !filter(s, index)) return;
      const dx = s.center[0] - x;
      const dz = s.center[2] - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    });
    return best;
  }

  /** The structure the camera leans toward: nearest unfelled one ahead of the vehicle. */
  private updateFocus(): void {
    this.forward.set(0, 0, 1).applyQuaternion(this.vehicleQuat);
    const ahead = (s: StructureInfo, index: number) => {
      if ((this.demolition[index] ?? 0) >= FELLED) return false;
      const dx = s.center[0] - this.vehiclePos.x;
      const dz = s.center[2] - this.vehiclePos.z;
      return dx * this.forward.x + dz * this.forward.z > 0;
    };
    const best =
      this.nearestStructure(this.vehiclePos.x, this.vehiclePos.z, ahead) ??
      this.nearestStructure(this.vehiclePos.x, this.vehiclePos.z, null);
    if (best) this.focus.set(best.center[0], Math.min(best.height / 3, 40), best.center[2]);
    else this.focus.copy(this.vehiclePos);
  }

  private updateCamera(dt: number): void {
    const k = this.cameraScale;
    const speedCurve = this.speedFraction * this.speedFraction;
    this.forward.y = 0;
    if (this.forward.lengthSq() < 1e-4) this.forward.set(0, 0, 1);
    this.forward.normalize();
    const back = CAMERA_BACK * k * (1 + (BACK_AT_SPEED - 1) * speedCurve);
    this.p.copy(this.vehiclePos).addScaledVector(this.forward, -back);
    this.p.y = Math.max(2, this.vehiclePos.y + CAMERA_UP * k);
    this.s.copy(this.vehiclePos).lerp(this.focus, LOOK_TOWARD_FOCUS);
    this.s.y += 1.5 * k;
    if (!this.cameraInitialised) {
      this.cameraPos.copy(this.p);
      this.lookAt.copy(this.s);
      this.cameraInitialised = true;
    } else {
      const a = 1 - Math.exp(-dt / CAMERA_LAG_S);
      this.cameraPos.lerp(this.p, a);
      this.lookAt.lerp(this.s, a);
    }
    this.camera.position.copy(this.cameraPos);
    this.camera.lookAt(this.lookAt);
    if (this.shake > 0.01) {
      const rad = (this.shake * Math.PI) / 180;
      this.camera.rotateX((Math.random() - 0.5) * 2 * rad);
      this.camera.rotateY((Math.random() - 0.5) * 2 * rad);
      this.camera.rotateZ((Math.random() - 0.5) * rad);
      this.shake *= Math.exp(-dt / SHAKE_DECAY_S);
    }
    const fov = FOV + (FOV_AT_SPEED - FOV) * speedCurve + this.fovPunch;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.fovPunch *= Math.exp(-dt / 0.25);
    // Sun follows the action so shadows stay crisp where the player is looking.
    this.sun.target.position.copy(this.vehiclePos).lerp(this.focus, 0.5);
    this.sun.position.copy(this.sun.target.position).add(this.p.set(60, 100, 40));
  }

  /** Driver's view: a cab-mounted camera aimed at the struck structure, in the bottom-right corner. */
  private renderPip(): void {
    const w = Math.round(this.width * 0.3);
    const h = Math.round((w * 9) / 16);
    const inset = Math.round(16 * Math.min(window.devicePixelRatio || 1, 2));
    const x = this.width - w - inset;
    const y = inset;
    const k = this.cameraScale;
    // Cab position: above and slightly forward of the chassis centre, inheriting its orientation.
    this.p
      .set(0, 1.4 * k, 1.2 * k)
      .applyQuaternion(this.vehicleQuat)
      .add(this.vehiclePos);
    this.pipCamera.position.copy(this.p);
    this.pipCamera.lookAt(this.pipTarget);
    this.renderer.setScissorTest(true);
    this.renderer.setScissor(x, y, w, h);
    this.renderer.setViewport(x, y, w, h);
    this.renderer.clearDepth();
    this.renderer.render(this.scene, this.pipCamera);
    this.renderer.setScissorTest(false);
  }
}

/** Cheap deterministic 0..1 hash for per-instance variation. */
function hash(i: number): number {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export { VEHICLE_SPECS };
