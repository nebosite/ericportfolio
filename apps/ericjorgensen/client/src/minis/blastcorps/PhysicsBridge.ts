import type {
  DriveControls,
  MainToWorker,
  ReadyMessage,
  SceneSpec,
  WorkerToMain,
} from "./sim/protocol";

// Main-thread handle on the physics worker. Snapshots arrive as transferred
// buffers; the consumer reads one synchronously in `onSnapshot` and the bridge
// hands the buffer straight back, so exactly two buffers ever exist.

export interface BridgeEvents {
  onReady: (ready: ReadyMessage) => void;
  onProgress: (built: number, total: number, builtParts: number) => void;
  onSnapshot: (snapshot: Float32Array) => void;
  onError: (message: string) => void;
}

export class PhysicsBridge {
  private readonly worker: Worker;
  /** Bytes received as snapshots since construction (for the bandwidth stat). */
  bytesReceived = 0;

  constructor(events: BridgeEvents) {
    this.worker = new Worker(new URL("./sim/physics.worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (event: MessageEvent<WorkerToMain>) => {
      const msg = event.data;
      switch (msg.type) {
        case "ready":
          events.onReady(msg);
          break;
        case "progress":
          events.onProgress(msg.built, msg.total, msg.builtParts);
          break;
        case "snapshot":
          this.bytesReceived += msg.buffer.byteLength;
          events.onSnapshot(new Float32Array(msg.buffer));
          this.send({ type: "recycle", buffer: msg.buffer }, [msg.buffer]);
          break;
        case "error":
          events.onError(msg.message);
          break;
      }
    };
    this.worker.onerror = (e) => events.onError(e.message || "physics worker failed");
  }

  init(scene: SceneSpec): void {
    this.send({ type: "init", scene });
  }

  setControls(controls: DriveControls): void {
    this.send({ type: "controls", controls });
  }

  reset(scene?: SceneSpec): void {
    this.send({ type: "reset", scene });
  }

  setTimeScale(value: number): void {
    this.send({ type: "timeScale", value });
  }

  terminate(): void {
    this.worker.terminate();
  }

  private send(msg: MainToWorker, transfer: Transferable[] = []): void {
    this.worker.postMessage(msg, transfer);
  }
}
