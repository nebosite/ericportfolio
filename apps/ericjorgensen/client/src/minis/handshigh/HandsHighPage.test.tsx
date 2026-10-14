import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import HandsHighPage from "./HandsHighPage";

function renderPage() {
  return render(
    <MemoryRouter>
      <HandsHighPage />
    </MemoryRouter>,
  );
}

function type(value: string) {
  fireEvent.change(screen.getByLabelText("Your message"), { target: { value } });
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("Hands High", () => {
  it("keeps Go disabled until a message is typed", () => {
    renderPage();
    expect(screen.getByRole("button", { name: "Go" })).toBeDisabled();
    type("hi");
    expect(screen.getByRole("button", { name: "Go" })).toBeEnabled();
  });

  it("shows the upper-cased message in the marquee and exits back to the form", () => {
    renderPage();
    type("  meet  here ");
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(screen.getByTestId("marquee")).toHaveTextContent("MEET HERE");
    fireEvent.click(screen.getByRole("button", { name: /Exit/ }));
    expect(screen.queryByTestId("marquee")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Your message")).toHaveValue("  meet  here ");
  });

  it("goes fullscreen when Go is pressed and leaves it when the marquee closes", () => {
    const request = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn().mockResolvedValue(undefined);
    document.documentElement.requestFullscreen = request;
    document.exitFullscreen = exit;
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: document.body });
    try {
      renderPage();
      type("hi");
      fireEvent.click(screen.getByRole("button", { name: "Go" }));
      expect(request).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: /Exit/ }));
      expect(exit).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
    }
  });

  it("still works where fullscreen is unavailable", () => {
    renderPage();
    type("hi");
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(screen.getByTestId("marquee")).toBeInTheDocument();
  });

  it("shows the example prompt as the placeholder", () => {
    renderPage();
    expect(screen.getByLabelText("Your message")).toHaveAttribute(
      "placeholder",
      'Enter a message.  e.g.: "Meet me at the fountain"',
    );
  });

  it("exits on Escape", () => {
    renderPage();
    type("x");
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("marquee")).not.toBeInTheDocument();
  });

  it("previews the message in both a portrait and a landscape phone before Go is pressed", () => {
    renderPage();
    expect(screen.getByTestId("preview-portrait")).toHaveTextContent("HANDS HIGH");
    expect(screen.getByTestId("preview-landscape")).toHaveTextContent("HANDS HIGH");
    type("look up");
    expect(screen.getByTestId("preview-portrait")).toHaveTextContent("LOOK UP");
    expect(screen.getByTestId("preview-landscape")).toHaveTextContent("LOOK UP");
  });

  it("offers sixteen swatches per picker, defaulting to green on black", () => {
    renderPage();
    const text = screen.getByRole("radiogroup", { name: "Text color" });
    const bg = screen.getByRole("radiogroup", { name: "Background color" });
    expect(within(text).getAllByRole("radio")).toHaveLength(16);
    expect(within(bg).getAllByRole("radio")).toHaveLength(16);
    expect(within(text).getByRole("radio", { name: "Green" })).toBeChecked();
    expect(within(bg).getByRole("radio", { name: "Black" })).toBeChecked();
  });

  it("applies chosen colors to the previews and the marquee", () => {
    renderPage();
    const text = screen.getByRole("radiogroup", { name: "Text color" });
    const bg = screen.getByRole("radiogroup", { name: "Background color" });
    fireEvent.click(within(text).getByRole("radio", { name: "Red" }));
    fireEvent.click(within(bg).getByRole("radio", { name: "Navy" }));
    expect(within(text).getByRole("radio", { name: "Red" })).toBeChecked();
    expect(screen.getByTestId("preview-portrait")).toHaveStyle({ background: "rgb(0, 0, 128)" });
    type("go");
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(screen.getByTestId("marquee")).toHaveStyle({ background: "rgb(0, 0, 128)" });
    expect(screen.getByText("GO")).toHaveStyle({ color: "rgb(255, 0, 0)" });
  });

  it("toggles bold, which restyles the preview and is remembered", () => {
    const first = renderPage();
    const bold = screen.getByRole("button", { name: "Bold: On" });
    expect(bold).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("preview-portrait").lastElementChild).toHaveStyle({
      fontWeight: "900",
    });
    fireEvent.click(bold);
    expect(screen.getByRole("button", { name: "Bold: Off" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByTestId("preview-portrait").lastElementChild).toHaveStyle({
      fontWeight: "400",
    });
    first.unmount();
    renderPage();
    expect(screen.getByRole("button", { name: "Bold: Off" })).toBeInTheDocument();
  });

  it("types the message in the same font as the marquee", () => {
    renderPage();
    const box = screen.getByLabelText("Your message");
    expect(box.style.fontFamily).toContain("Arial Black");
    fireEvent.click(screen.getByRole("button", { name: "Bold: On" }));
    expect(box.style.fontFamily).toMatch(/^Arial,/);
    expect(box).toHaveStyle({ fontWeight: "400" });
    fireEvent.click(screen.getByRole("radio", { name: "Narrow" }));
    expect(box.style.fontFamily).toContain("Arial Narrow");
  });

  it("switches between a wide and a narrow font in the preview and the marquee", () => {
    renderPage();
    const group = screen.getByRole("radiogroup", { name: "Font" });
    expect(within(group).getByRole("radio", { name: "Wide" })).toBeChecked();
    fireEvent.click(within(group).getByRole("radio", { name: "Narrow" }));
    expect(within(group).getByRole("radio", { name: "Narrow" })).toBeChecked();
    expect(screen.getByTestId("preview-landscape").lastElementChild).toHaveStyle({
      fontStretch: "condensed",
    });
    type("go");
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(screen.getByText("GO").style.fontFamily).toContain("Arial Narrow");
  });

  it("remembers the speed slider", () => {
    const first = renderPage();
    fireEvent.change(screen.getByLabelText("Speed"), { target: { value: "3.5" } });
    first.unmount();
    renderPage();
    expect(screen.getByLabelText("Speed")).toHaveValue("3.5");
  });

  it("remembers the last message", () => {
    const first = renderPage();
    type("wave");
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    first.unmount();
    renderPage();
    expect(screen.getByLabelText("Your message")).toHaveValue("wave");
  });
});
