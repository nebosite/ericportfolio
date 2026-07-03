import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import HomePage from "./HomePage";

describe("The J Crew HomePage", () => {
  it("renders the title and welcome copy without crashing", () => {
    render(<HomePage />);
    expect(screen.getByRole("heading", { name: /the j crew/i })).toBeInTheDocument();
    expect(screen.getByText(/pull up a chair/i)).toBeInTheDocument();
  });
});
