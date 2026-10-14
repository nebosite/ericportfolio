import * as THREE from "three";
import { MAX_WHEELS, type VehicleKind } from "../sim/protocol";
import { VEHICLE_SPECS, type VehicleSpec } from "../sim/Vehicle";

// Visual bodies for the two machines, built from boxes and cylinders so they
// pose straight from the physics. The dozer is a yellow site machine; the
// tractor is the game's fanciful element — an industrial Terminator: gunmetal
// hull, serrated V-blade, raked cab with a red sensor slot, twin stacks with hot
// tips, piston struts in yellow collars, a slatted engine block around a cyan
// core, red hub rings and hazard chevrons. Cool fill light keeps its silhouette
// readable in smoke.

export class VehicleModel {
  readonly group = new THREE.Group();
  readonly wheels: THREE.Mesh[] = [];
  readonly spec: VehicleSpec;
  /** Follow-camera distance multiplier relative to the dozer. */
  readonly cameraScale: number;

  constructor(kind: VehicleKind, scene: THREE.Scene) {
    this.spec = VEHICLE_SPECS[kind];
    this.cameraScale = kind === "tractor" ? 5 : 1;
    if (kind === "tractor") this.buildTractor();
    else this.buildDozer();
    const wheelGeom = new THREE.CylinderGeometry(
      this.spec.wheelRadius,
      this.spec.wheelRadius,
      this.spec.wheelWidth,
      kind === "tractor" ? 32 : 24,
    );
    wheelGeom.rotateZ(Math.PI / 2); // axle along x, as the physics reports it
    const tyre = new THREE.MeshStandardMaterial({ color: 0x1a1c1e, roughness: 0.9 });
    const hub = new THREE.MeshStandardMaterial({
      color: 0x3a0a0a,
      emissive: 0xff2020,
      emissiveIntensity: kind === "tractor" ? 3 : 0,
      roughness: 0.4,
      metalness: 0.6,
    });
    for (let i = 0; i < MAX_WHEELS; i++) {
      const wheel = new THREE.Mesh(wheelGeom, tyre);
      wheel.castShadow = true;
      wheel.visible = i < this.spec.wheelPositions.length;
      if (kind === "tractor") {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(this.spec.wheelRadius * 0.55, 0.12, 8, 32),
          hub,
        );
        ring.rotation.y = Math.PI / 2;
        ring.position.x = this.spec.wheelWidth / 2 + 0.01;
        wheel.add(ring);
        const ring2 = ring.clone();
        ring2.position.x = -ring.position.x;
        wheel.add(ring2);
      }
      this.wheels.push(wheel);
      scene.add(wheel);
    }
    scene.add(this.group);
  }

  private add(geom: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) {
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  private buildDozer(): void {
    const body = new THREE.MeshStandardMaterial({
      color: 0xe6a21a,
      roughness: 0.55,
      metalness: 0.2,
    });
    const dark = new THREE.MeshStandardMaterial({
      color: 0x2b2f33,
      roughness: 0.6,
      metalness: 0.4,
    });
    const glass = new THREE.MeshStandardMaterial({
      color: 0x163040,
      roughness: 0.2,
      metalness: 0.6,
    });
    const steel = new THREE.MeshStandardMaterial({
      color: 0x8a8f94,
      roughness: 0.4,
      metalness: 0.8,
    });
    const c = this.spec.chassis;
    const b = this.spec.blade;
    this.add(new THREE.BoxGeometry(c[0] * 2, c[1] * 2, c[2] * 2), body, 0, 0, 0);
    this.add(new THREE.BoxGeometry(2.0, 1.0, 1.6), glass, 0, c[1] + 0.5, -0.8);
    this.add(new THREE.BoxGeometry(2.2, 0.2, 1.8), body, 0, c[1] + 1.05, -0.8);
    this.add(
      new THREE.BoxGeometry(b[0] * 2, b[1] * 2, b[2] * 2),
      steel,
      0,
      this.spec.bladeY,
      c[2] + b[2],
    );
    this.add(new THREE.BoxGeometry(0.2, 0.2, 1.6), dark, -1.0, -0.4, c[2] - 0.6);
    this.add(new THREE.BoxGeometry(0.2, 0.2, 1.6), dark, 1.0, -0.4, c[2] - 0.6);
  }

  private buildTractor(): void {
    const hull = new THREE.MeshStandardMaterial({
      color: 0x1c1f22,
      roughness: 0.55,
      metalness: 0.7,
    });
    const hullLight = new THREE.MeshStandardMaterial({
      color: 0x2a2e33,
      roughness: 0.5,
      metalness: 0.7,
    });
    const bladeSteel = new THREE.MeshStandardMaterial({
      color: 0xc8ccd0,
      roughness: 0.35,
      metalness: 0.9,
    });
    const yellow = new THREE.MeshStandardMaterial({
      color: 0xf2c200,
      roughness: 0.5,
      metalness: 0.2,
    });
    const eye = new THREE.MeshStandardMaterial({
      color: 0x400000,
      emissive: 0xff2020,
      emissiveIntensity: 3,
    });
    const core = new THREE.MeshStandardMaterial({
      color: 0x083040,
      emissive: 0x40e0ff,
      emissiveIntensity: 2.5,
    });
    const hot = new THREE.MeshStandardMaterial({
      color: 0x401000,
      emissive: 0xff5a1a,
      emissiveIntensity: 2,
    });
    const c = this.spec.chassis; // [7.5, 2.0, 11]
    const b = this.spec.blade; // [7.5, 2.6, 0.5]

    // Hull: main slab, chamfered by stacking a narrower upper deck.
    this.add(new THREE.BoxGeometry(c[0] * 2, c[1] * 2, c[2] * 2), hull, 0, 0, 0);
    this.add(new THREE.BoxGeometry(c[0] * 1.7, 1.2, c[2] * 1.6), hullLight, 0, c[1] + 0.6, -1.0);
    // Hazard chevron stripes along the hull sides and blade top.
    for (const side of [-1, 1]) {
      this.add(new THREE.BoxGeometry(0.1, 0.6, c[2] * 1.9), yellow, side * (c[0] + 0.02), 0.8, 0);
    }
    // Raked cab slab with the red sensor slot.
    const cab = this.add(
      new THREE.BoxGeometry(9, 3.2, 4.5),
      hull,
      0,
      c[1] + 1.2 + 1.6,
      -c[2] * 0.4,
    );
    cab.rotation.x = -0.18;
    this.add(new THREE.BoxGeometry(7.5, 0.35, 0.3), eye, 0, c[1] + 1.2 + 2.2, -c[2] * 0.4 + 2.3);
    // Twin stacks with hot tips.
    for (const side of [-1, 1]) {
      this.add(
        new THREE.CylinderGeometry(0.6, 0.7, 6, 12),
        hullLight,
        side * 4.5,
        c[1] + 0.6 + 3.6,
        -c[2] * 0.75,
      );
      this.add(
        new THREE.CylinderGeometry(0.5, 0.5, 0.4, 12),
        hot,
        side * 4.5,
        c[1] + 0.6 + 6.7,
        -c[2] * 0.75,
      );
    }
    // Slatted rear engine block around a cyan core.
    this.add(new THREE.BoxGeometry(10, 3.4, 2.4), hullLight, 0, c[1] + 0.6, -c[2] + 1.0);
    this.add(new THREE.BoxGeometry(6, 1.2, 0.3), core, 0, c[1] + 0.6, -c[2] - 0.2);
    for (let i = -2; i <= 2; i++) {
      this.add(new THREE.BoxGeometry(10.2, 0.2, 0.3), hull, 0, c[1] + 0.6 + i * 0.6, -c[2] - 0.25);
    }
    // Serrated V-wedge blade: two angled halves plus teeth along the lower edge.
    for (const side of [-1, 1]) {
      const half = this.add(
        new THREE.BoxGeometry(b[0], b[1] * 2, b[2] * 2),
        bladeSteel,
        side * b[0] * 0.5,
        this.spec.bladeY,
        c[2] + b[2],
      );
      half.rotation.y = side * 0.22;
      half.position.z -= Math.abs(side) * 0.8;
    }
    for (let i = -6; i <= 6; i++) {
      this.add(
        new THREE.BoxGeometry(0.7, 0.8, 0.9),
        bladeSteel,
        i * 1.1,
        this.spec.bladeY - b[1] + 0.2,
        c[2] + b[2] + 0.4,
      );
    }
    this.add(
      new THREE.BoxGeometry(b[0] * 2, 0.3, 0.8),
      yellow,
      0,
      this.spec.bladeY + b[1] + 0.1,
      c[2] + b[2],
    );
    // Four piston struts with yellow collars, hull to blade.
    for (const side of [-1, 1]) {
      for (const h of [0.6, -0.8]) {
        const strut = this.add(
          new THREE.CylinderGeometry(0.28, 0.28, 4.2, 10),
          hullLight,
          side * 4.8,
          h,
          c[2] - 1.0,
        );
        strut.rotation.x = Math.PI / 2;
        this.add(
          new THREE.CylinderGeometry(0.42, 0.42, 0.6, 10),
          yellow,
          side * 4.8,
          h,
          c[2] - 2.4,
        ).rotation.x = Math.PI / 2;
      }
    }
    // Articulation ring between hull and rear block.
    const ring = this.add(
      new THREE.TorusGeometry(2.4, 0.3, 8, 24),
      hullLight,
      0,
      0.2,
      -c[2] * 0.72,
    );
    ring.rotation.x = Math.PI / 2;
    // Cool fill light parented to the hull keeps the silhouette in smoke.
    const fill = new THREE.PointLight(0x40e0ff, 60, 60, 2);
    fill.position.set(0, c[1] + 2, -c[2] * 0.5);
    this.group.add(fill);
  }
}
