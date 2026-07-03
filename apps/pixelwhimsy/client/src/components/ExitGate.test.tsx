import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import ExitGate from "./ExitGate";

afterEach(cleanup);

function renderGate(
  answer: number,
  handlers: Partial<Record<"onSolved" | "onWrong" | "onCancel", () => void>> = {},
) {
  const onSolved = handlers.onSolved ?? vi.fn();
  const onWrong = handlers.onWrong ?? vi.fn();
  const onCancel = handlers.onCancel ?? vi.fn();
  const utils = render(
    <ExitGate
      problem={{ a: Math.floor(answer / 2) || 2, b: 2, answer }}
      onSolved={onSolved}
      onWrong={onWrong}
      onCancel={onCancel}
    />,
  );
  return { ...utils, onSolved, onWrong, onCancel };
}

describe("ExitGate", () => {
  it("solves on the exact answer, evaluated as it is typed (no Enter)", () => {
    const { onSolved } = renderGate(56);
    const input = screen.getByLabelText("Answer");
    fireEvent.change(input, { target: { value: "5" } });
    expect(onSolved).not.toHaveBeenCalled(); // 5 is just a prefix of 56
    fireEvent.change(input, { target: { value: "56" } });
    expect(onSolved).toHaveBeenCalledTimes(1);
  });

  it("fails fast on a wrong answer", () => {
    const { onWrong, onSolved } = renderGate(6);
    fireEvent.change(screen.getByLabelText("Answer"), { target: { value: "7" } });
    expect(onWrong).toHaveBeenCalledTimes(1);
    expect(onSolved).not.toHaveBeenCalled();
  });

  it("ignores non-digit input", () => {
    const { onSolved, onWrong } = renderGate(20);
    const input = screen.getByLabelText("Answer") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "abc" } });
    expect(onSolved).not.toHaveBeenCalled();
    expect(onWrong).not.toHaveBeenCalled();
    expect(input.value).toBe(""); // stripped to nothing typed
  });

  it("offers a numeric input so mobile shows the number keypad", () => {
    renderGate(12);
    expect(screen.getByLabelText("Answer")).toHaveAttribute("inputmode", "numeric");
  });

  it("keeps painting (cancels) when the backdrop is tapped", () => {
    const onCancel = vi.fn();
    const { container } = renderGate(4, { onCancel });
    fireEvent.pointerDown(container.firstChild as Element);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
