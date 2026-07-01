import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import GrownMark from "./GrownMark";

afterEach(cleanup);

describe("GrownMark", () => {
  it("staggers branch growth with a per-generation delay (trunk first)", () => {
    const { container } = render(
      <GrownMark seed="x" style="wild" accent="#000" />,
    );
    const lines = Array.from(container.querySelectorAll("line"));
    expect(lines.length).toBeGreaterThan(0);

    const delays = lines.map((l) =>
      (l as SVGLineElement).style.getPropertyValue("--gm-delay"),
    );
    expect(delays.every((d) => d.endsWith("s"))).toBe(true);
    expect(delays).toContain("0s"); // the trunk grows first
    expect(delays.some((d) => parseFloat(d) > 0)).toBe(true); // deeper branches later
  });

  it("gives each line a dash length so it can draw in", () => {
    const { container } = render(
      <GrownMark seed="y" style="sapling" accent="#000" />,
    );
    const line = container.querySelector("line") as SVGLineElement;
    expect(line.style.getPropertyValue("--gm-len")).not.toBe("");
    expect(line.style.strokeDasharray).not.toBe("");
  });
});
