import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import VolumeControl from "./VolumeControl";
import { getVolume, setVolume } from "../lib/volume";

beforeEach(() => {
  localStorage.clear();
  setVolume(1); // known starting point
});

afterEach(cleanup);

describe("VolumeControl", () => {
  it("shows the current volume and updates the shared setting on slide", () => {
    render(<VolumeControl />);
    const slider = screen.getByLabelText("Volume") as HTMLInputElement;
    expect(slider.value).toBe("100");
    expect(screen.getByText("100%")).toBeInTheDocument();

    fireEvent.change(slider, { target: { value: "40" } });
    expect(getVolume()).toBeCloseTo(0.4);
    expect(screen.getByText("40%")).toBeInTheDocument();
  });

  it("mute toggles to zero and back to full", () => {
    render(<VolumeControl />);
    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    expect(getVolume()).toBe(0);
    expect(screen.getByText("MUTED")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Unmute" }));
    expect(getVolume()).toBe(1);
  });

  it("reflects an external volume change (shared across games)", () => {
    render(<VolumeControl />);
    act(() => setVolume(0.25));
    expect(screen.getByText("25%")).toBeInTheDocument();
  });
});
