// Which Jolt build to load and how many worker threads to give it. Pure, so the
// worker's one decision is unit-tested: the multithreaded wasm needs
// SharedArrayBuffer, which only a cross-origin-isolated page has, and a spare
// core to be worth it. We cap pthreads so a many-core desktop doesn't spawn
// dozens of workers for a scene that mostly sleeps.

export interface Environment {
  crossOriginIsolated: boolean;
  hasSharedArrayBuffer: boolean;
  cores: number;
}

export interface JoltChoice {
  flavour: "multithread" | "single";
  /** Worker threads Jolt may spawn (0 for the single-threaded build). */
  threads: number;
}

export const MAX_THREADS = 15;

export function chooseJolt(env: Environment): JoltChoice {
  if (env.crossOriginIsolated && env.hasSharedArrayBuffer && env.cores > 1) {
    return { flavour: "multithread", threads: Math.min(env.cores - 1, MAX_THREADS) };
  }
  return { flavour: "single", threads: 0 };
}
