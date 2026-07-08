import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import HomePage from "./HomePage";

afterEach(cleanup);

describe("The J Crew HomePage", () => {
  it("renders the title and welcome copy without crashing", () => {
    render(<HomePage />);
    expect(screen.getByRole("heading", { name: /the j crew/i })).toBeInTheDocument();
    expect(screen.getByText(/pull up a chair/i)).toBeInTheDocument();
  });

  it("footer credits Eric Jorgensen and links to his site", () => {
    render(<HomePage />);
    const year = new Date().getFullYear();
    const link = screen.getByRole("link", { name: `© ${year} Eric Jorgensen` });
    expect(link).toHaveAttribute("href", "https://www.ericjorgensen.com");
  });
});
