import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import SiteFooter from "./SiteFooter";

vi.mock("../lib/analytics", () => ({ trackEvent: vi.fn() }));

afterEach(cleanup);

describe("SiteFooter", () => {
  it("shows a copyright notice attributed to Eric Jorgensen", () => {
    render(<SiteFooter />);
    const year = new Date().getFullYear();
    expect(screen.getByText(`© ${year} Eric Jorgensen`)).toBeInTheDocument();
  });

  it("links the copyright to www.ericjorgensen.com", () => {
    render(<SiteFooter />);
    const link = screen.getByRole("link", { name: /Eric Jorgensen/ });
    expect(link).toHaveAttribute("href", "https://www.ericjorgensen.com");
  });

  it("renders an optional page tagline before the copyright", () => {
    render(<SiteFooter>Each mark grown once.</SiteFooter>);
    expect(screen.getByText("Each mark grown once.")).toBeInTheDocument();
  });
});
