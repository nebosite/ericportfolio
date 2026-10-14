import { describe, it, expect } from "vitest";
import { MAX_THREADS, chooseJolt } from "./joltFlavour";

describe("chooseJolt", () => {
  it("uses the multithreaded build with one thread per spare core when isolated", () => {
    expect(
      chooseJolt({ crossOriginIsolated: true, hasSharedArrayBuffer: true, cores: 16 }),
    ).toEqual({
      flavour: "multithread",
      threads: 15,
    });
    expect(chooseJolt({ crossOriginIsolated: true, hasSharedArrayBuffer: true, cores: 4 })).toEqual(
      {
        flavour: "multithread",
        threads: 3,
      },
    );
  });

  it("caps the thread count", () => {
    expect(
      chooseJolt({ crossOriginIsolated: true, hasSharedArrayBuffer: true, cores: 64 }).threads,
    ).toBe(MAX_THREADS);
  });

  it("falls back to the single-threaded build without isolation, SAB or spare cores", () => {
    const single = { flavour: "single", threads: 0 };
    expect(
      chooseJolt({ crossOriginIsolated: false, hasSharedArrayBuffer: true, cores: 16 }),
    ).toEqual(single);
    expect(
      chooseJolt({ crossOriginIsolated: true, hasSharedArrayBuffer: false, cores: 16 }),
    ).toEqual(single);
    expect(chooseJolt({ crossOriginIsolated: true, hasSharedArrayBuffer: true, cores: 1 })).toEqual(
      single,
    );
  });
});
