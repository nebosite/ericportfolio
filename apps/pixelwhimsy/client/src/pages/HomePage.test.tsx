import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import HomePage from "./HomePage";

beforeEach(() => sessionStorage.clear());
afterEach(cleanup);

describe("PixelWhimsy title screen", () => {
  it("renders the logo and tagline", () => {
    render(<HomePage />);
    expect(screen.getByAltText("PixelWhimsy")).toBeInTheDocument();
    expect(screen.getByText(/paint tiny pictures/i)).toBeInTheDocument();
  });

  it("shows the grown-up notes and the feedback buttons", () => {
    render(<HomePage />);
    expect(screen.getByText(/for grown-ups/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Feature Request" })).toBeInTheDocument();
  });

  it("enters the full-screen paint sandbox on Start", () => {
    const { container } = render(<HomePage />);
    expect(container.querySelector("canvas")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /start painting/i }));
    expect(container.querySelector("canvas")).toBeTruthy();
    // toolbar + exit are now present
    expect(screen.getByRole("button", { name: "Fill" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exit" })).toBeInTheDocument();
  });

  it("resumes the drawing screen after a reload (does not drop to the title)", () => {
    sessionStorage.setItem("pw_playing", "1"); // a reload mid-play
    const { container } = render(<HomePage />);
    expect(container.querySelector("canvas")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /start painting/i })).not.toBeInTheDocument();
  });
});
