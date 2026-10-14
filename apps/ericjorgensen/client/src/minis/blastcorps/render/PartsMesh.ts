import * as THREE from "three";
import { POSE_FLOATS } from "../sim/protocol";

// Every building part in one draw call, posed on the GPU. The snapshot's pose
// array (position xyz + quaternion xyzw per part) is uploaded as an interleaved
// instance attribute and the vertex shader rotates a unit box by the quaternion,
// so the CPU never composes a matrix — the per-frame cost is one buffer upload
// however many parts there are. Lighting is hemisphere + one directional lambert
// term with fog; parts don't cast shadows at this scale.

export interface PartVisual {
  half: [number, number, number];
  color: [number, number, number];
}

const VERTEX = /* glsl */ `
  attribute vec3 instancePosition;
  attribute vec4 instanceQuat;
  attribute vec3 instanceScale;
  attribute vec3 instanceColor;
  attribute float instanceIndex;
  uniform float builtParts;
  varying vec3 vColor;
  varying vec3 vNormalW;
  varying float vViewZ;
  vec3 rotate(vec4 q, vec3 v) {
    return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
  }
  void main() {
    // Parts whose physics hasn't been built yet are hidden (collapsed to a point behind the camera).
    if (instanceIndex >= builtParts) {
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
      vColor = vec3(0.0);
      vNormalW = vec3(0.0, 1.0, 0.0);
      vViewZ = 0.0;
      return;
    }
    vec3 p = rotate(instanceQuat, position * instanceScale) + instancePosition;
    vNormalW = rotate(instanceQuat, normal);
    vColor = instanceColor;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vViewZ = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 sunDir;
  uniform vec3 sunColor;
  uniform vec3 skyColor;
  uniform vec3 groundColor;
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;
  varying vec3 vColor;
  varying vec3 vNormalW;
  varying float vViewZ;
  void main() {
    vec3 n = normalize(vNormalW);
    vec3 ambient = mix(groundColor, skyColor, 0.5 + 0.5 * n.y);
    float diffuse = max(dot(n, sunDir), 0.0);
    vec3 c = vColor * (ambient + sunColor * diffuse);
    float f = smoothstep(fogNear, fogFar, vViewZ);
    gl_FragColor = vec4(mix(c, fogColor, f), 1.0);
  }
`;

export class PartsMesh {
  readonly mesh: THREE.Mesh;
  readonly count: number;
  private readonly poseBuffer: THREE.InstancedInterleavedBuffer;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly material: THREE.ShaderMaterial;

  constructor(parts: PartVisual[], lighting: PartsLighting) {
    this.count = parts.length;
    const box = new THREE.BoxGeometry(1, 1, 1);
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.index = box.index;
    this.geometry.setAttribute("position", box.getAttribute("position"));
    this.geometry.setAttribute("normal", box.getAttribute("normal"));
    this.geometry.instanceCount = this.count;

    const poses = new Float32Array(this.count * POSE_FLOATS);
    for (let i = 0; i < this.count; i++) poses[i * POSE_FLOATS + 6] = 1; // identity quaternions
    this.poseBuffer = new THREE.InstancedInterleavedBuffer(poses, POSE_FLOATS, 1);
    this.poseBuffer.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute(
      "instancePosition",
      new THREE.InterleavedBufferAttribute(this.poseBuffer, 3, 0),
    );
    this.geometry.setAttribute(
      "instanceQuat",
      new THREE.InterleavedBufferAttribute(this.poseBuffer, 4, 3),
    );

    const scale = new Float32Array(this.count * 3);
    const color = new Float32Array(this.count * 3);
    const index = new Float32Array(this.count);
    parts.forEach((p, i) => {
      scale.set([p.half[0] * 2, p.half[1] * 2, p.half[2] * 2], i * 3);
      color.set(p.color, i * 3);
      index[i] = i;
    });
    this.geometry.setAttribute("instanceScale", new THREE.InstancedBufferAttribute(scale, 3));
    this.geometry.setAttribute("instanceColor", new THREE.InstancedBufferAttribute(color, 3));
    this.geometry.setAttribute("instanceIndex", new THREE.InstancedBufferAttribute(index, 1));

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        builtParts: { value: this.count },
        sunDir: { value: lighting.sunDir.clone().normalize() },
        sunColor: { value: lighting.sunColor },
        skyColor: { value: lighting.skyColor },
        groundColor: { value: lighting.groundColor },
        fogColor: { value: lighting.fogColor },
        fogNear: { value: lighting.fogNear },
        fogFar: { value: lighting.fogFar },
      },
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false; // instances span the whole street
  }

  /** Upload a pose array (7 floats per part, `count` parts) read from a snapshot. */
  update(poses: Float32Array, offset: number): void {
    (this.poseBuffer.array as Float32Array).set(
      poses.subarray(offset, offset + this.count * POSE_FLOATS),
    );
    this.poseBuffer.needsUpdate = true;
  }

  /** Hide parts whose physics hasn't been built yet (structures build in index order). */
  setBuiltParts(n: number): void {
    this.material.uniforms.builtParts.value = n;
  }

  /** Triangles drawn per frame (for the stats panel). */
  get triangles(): number {
    return ((this.geometry.index?.count ?? 0) / 3) * this.count;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

export interface PartsLighting {
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  skyColor: THREE.Color;
  groundColor: THREE.Color;
  fogColor: THREE.Color;
  fogNear: number;
  fogFar: number;
}
