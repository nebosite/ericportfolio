import { chooseJolt } from "./joltFlavour";
import { Simulation } from "./Simulation";
import type { MainToWorker, WorkerToMain } from "./protocol";
import type { JoltModule } from "./PhysicsWorld";

// Web Worker entry: owns the Simulation and pumps its fixed-step clock off the
// main thread, so rendering never waits on physics. Deliberately thin — all
// behaviour lives in Simulation, which the headless tests cover.
//
// Threads: when the page is cross-origin isolated (COOP + COEP headers, so
// SharedArrayBuffer exists) we load Jolt's multithreaded build and let it spawn
// one pthread per spare core. Emscripten starts those pthreads as Web Workers
// running the *Jolt chunk's* URL — which is why Jolt is imported dynamically
// (its own chunk) and why anything named "em-pthread" must not run this file.

const ctx = self as unknown as Worker; // the client tsconfig has only the DOM lib
const isPthreadHelper = (self as unknown as { name?: string }).name === "em-pthread";

const send = (msg: WorkerToMain, transfer: Transferable[] = []) => ctx.postMessage(msg, transfer);

let sim: Simulation | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Load the right Jolt flavour for this page and report how many threads it may use. */
async function loadJolt(): Promise<{ J: JoltModule; threads: number; isolated: boolean }> {
  const isolated = typeof crossOriginIsolated !== "undefined" && crossOriginIsolated;
  const choice = chooseJolt({
    crossOriginIsolated: isolated,
    hasSharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
    cores: typeof navigator !== "undefined" ? (navigator.hardwareConcurrency ?? 1) : 1,
  });
  if (choice.flavour === "multithread") {
    const mod = await import("jolt-physics/wasm-compat-multithread");
    return { J: await mod.default(), threads: choice.threads, isolated };
  }
  const mod = await import("jolt-physics");
  return { J: await mod.default(), threads: 0, isolated };
}

const loop = () => {
  if (!sim) return;
  try {
    sim.tick(performance.now());
    if (sim.buildNext()) send({ type: "progress", ...sim.progress() });
  } catch (err) {
    send({ type: "error", message: err instanceof Error ? err.message : String(err) });
    return;
  }
  timer = setTimeout(loop, 4); // the accumulator in tick() keeps the sim at 60 Hz
};

const onMessage = async (event: MessageEvent<MainToWorker>) => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case "init": {
        const { J, threads, isolated } = await loadJolt();
        sim = new Simulation(
          J,
          msg.scene,
          (buffer) => send({ type: "snapshot", buffer }, [buffer]),
          {
            threads,
          },
        );
        send({ type: "ready", ...sim.describe(), threads, crossOriginIsolated: isolated });
        loop();
        break;
      }
      case "controls":
        sim?.setControls(msg.controls);
        break;
      case "timeScale":
        sim?.setTimeScale(msg.value);
        break;
      case "recycle":
        sim?.recycle(msg.buffer);
        break;
      case "reset":
        if (sim) {
          if (timer) clearTimeout(timer);
          sim.reset(msg.scene);
          send({
            type: "ready",
            ...sim.describe(),
            threads: sim.threads,
            crossOriginIsolated: sim.isolated,
          });
          loop();
        }
        break;
    }
  } catch (err) {
    send({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};

if (!isPthreadHelper) ctx.onmessage = onMessage;
