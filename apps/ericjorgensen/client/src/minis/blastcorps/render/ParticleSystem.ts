import * as THREE from "three";
import { KIND_GRAVITY, ParticleKind, ParticleRing, type SpawnRange } from "./particles";

// A ParticleRing drawn as THREE.Points. Every per-particle attribute is static
// after spawn; the vertex shader integrates position from (origin, velocity,
// birth, life, kind) against a `time` uniform and clamps to the ground, so a
// 150k-particle cloud costs the GPU one pass and the CPU nothing per frame.
// Spawned ranges are uploaded with partial buffer updates.

const VERTEX = /* glsl */ `
  attribute vec3 origin;
  attribute vec3 velocity;
  attribute float birth;
  attribute float life;
  attribute float kind;
  attribute float size;
  attribute float seed;
  uniform float time;
  uniform float gravity[7];
  uniform float pixelScale;
  varying float vKind;
  varying float vAge;
  varying float vSeed;
  void main() {
    float t = time - birth;
    if (t < 0.0 || t > life) {
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      vKind = kind; vAge = 1.0; vSeed = seed;
      return;
    }
    int k = int(kind + 0.5);
    float g = gravity[k];
    vec3 p = origin + velocity * t + vec3(0.0, 0.5 * g * t * t, 0.0);
    // Drag: heavy kinds keep flying, light kinds slow quickly.
    float drag = (k == 0 || k == 2 || k == 3 || k == 6) ? exp(-t * 1.2) : 1.0;
    p = origin + (p - origin) * mix(1.0, drag, (k == 0 || k == 2 || k == 3 || k == 6) ? 1.0 : 0.0);
    if (p.y < 0.08) p.y = 0.08;
    float age = t / life;
    // Dust, smoke and steam swell with age; chips, shards and sparks don't.
    float grow = (k == 0) ? 1.0 + 1.5 * age : (k == 2) ? 1.0 + 2.5 * age : (k == 3) ? 1.0 + 1.5 * age : (k == 6) ? 1.0 + 0.5 * age : 1.0;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = size * grow * pixelScale / max(1.0, -mv.z);
    vKind = kind;
    vAge = age;
    vSeed = seed;
  }
`;

const FRAGMENT = /* glsl */ `
  varying float vKind;
  varying float vAge;
  varying float vSeed;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d) * 2.0;
    if (r > 1.0) discard;
    int k = int(vKind + 0.5);
    float soft = 1.0 - r * r;
    vec3 c; float a;
    if (k == 0) { c = vec3(0.62, 0.55, 0.45); a = 0.35 * soft * (1.0 - vAge); }               // dust
    else if (k == 1) { c = vec3(0.42, 0.40, 0.37) * (0.7 + 0.6 * vSeed); a = soft > 0.3 ? 1.0 : 0.0; } // chip
    else if (k == 2) { c = vec3(0.18, 0.18, 0.19); a = 0.28 * soft * (1.0 - vAge) * min(1.0, vAge * 6.0); } // smoke
    else if (k == 3) { c = vec3(0.92, 0.94, 0.97); a = 0.4 * soft * (1.0 - vAge); }           // steam
    else if (k == 4) { c = vec3(0.65, 0.80, 0.90) * (0.8 + 0.4 * vSeed); a = soft > 0.25 ? 0.9 : 0.0; } // shard
    else if (k == 5) { c = mix(vec3(1.0, 0.95, 0.75), vec3(1.0, 0.45, 0.1), vAge); a = soft * (1.0 - vAge); } // spark
    else { c = mix(vec3(1.0, 0.85, 0.35), vec3(0.9, 0.2, 0.05), vAge); a = soft * (1.0 - vAge) * 0.9; } // flame
    gl_FragColor = vec4(c, a);
  }
`;

export class ParticleSystem {
  readonly ring: ParticleRing;
  readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;
  private readonly attributes: THREE.BufferAttribute[];

  constructor(capacity: number, additive: boolean) {
    this.ring = new ParticleRing(capacity);
    const geometry = new THREE.BufferGeometry();
    const attr = (array: Float32Array, size: number) => {
      const a = new THREE.BufferAttribute(array, size);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.attributes = [
      attr(this.ring.origin, 3),
      attr(this.ring.velocity, 3),
      attr(this.ring.birth, 1),
      attr(this.ring.life, 1),
      attr(this.ring.kind, 1),
      attr(this.ring.size, 1),
      attr(this.ring.seed, 1),
    ];
    geometry.setAttribute("position", this.attributes[0]); // three needs a `position`; the shader reads `origin`
    geometry.setAttribute("origin", this.attributes[0]);
    geometry.setAttribute("velocity", this.attributes[1]);
    geometry.setAttribute("birth", this.attributes[2]);
    geometry.setAttribute("life", this.attributes[3]);
    geometry.setAttribute("kind", this.attributes[4]);
    geometry.setAttribute("size", this.attributes[5]);
    geometry.setAttribute("seed", this.attributes[6]);
    const gravity = Object.values(ParticleKind)
      .filter((v): v is ParticleKind => typeof v === "number")
      .sort((a, b) => a - b)
      .map((k) => KIND_GRAVITY[k]);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { time: { value: 0 }, gravity: { value: gravity }, pixelScale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 2 : 1;
  }

  /** Mark freshly written ring ranges for upload. */
  commit(ranges: SpawnRange[]): void {
    for (const a of this.attributes) {
      for (const r of ranges) a.addUpdateRange(r.start * a.itemSize, r.count * a.itemSize);
      a.needsUpdate = true;
    }
  }

  /** Advance the clock; `pixelScale` ties point size to viewport height. */
  update(timeSeconds: number, viewportHeightPx: number): void {
    this.material.uniforms.time.value = timeSeconds;
    this.material.uniforms.pixelScale.value = viewportHeightPx * 0.9;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
