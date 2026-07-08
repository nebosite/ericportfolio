import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import HomePage from "./HomePage";

vi.mock("../lib/analytics", () => ({ trackEvent: vi.fn() }));

afterEach(cleanup);

describe("Big Tiny Games HomePage", () => {
  it("footer credits Eric Jorgensen and links to his site", () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );
    const year = new Date().getFullYear();
    const link = screen.getByRole("link", { name: `© ${year} Eric Jorgensen` });
    expect(link).toHaveAttribute("href", "https://www.ericjorgensen.com");
  });
});
