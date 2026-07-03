import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import FeedbackPanel, { MAX_FEEDBACK } from "./FeedbackPanel";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("FeedbackPanel — entry", () => {
  it("shows the two standard buttons", () => {
    render(<FeedbackPanel entity="pitchcraft" />);
    expect(screen.getByRole("button", { name: "Feature Request" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Vote on feature requests" })).toBeInTheDocument();
  });

  it("does not let keystrokes reach window-level handlers", () => {
    const onWindowKey = vi.fn();
    window.addEventListener("keydown", onWindowKey);
    try {
      render(<FeedbackPanel entity="pitchcraft" />);
      fireEvent.click(screen.getByRole("button", { name: "Feature Request" }));
      fireEvent.keyDown(screen.getByLabelText("Your feedback"), {
        key: "ArrowUp",
      });
      fireEvent.keyDown(screen.getByLabelText("Your feedback"), { key: " " });
      expect(onWindowKey).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", onWindowKey);
    }
  });
});

describe("FeedbackPanel — leave feedback", () => {
  it("caps the textarea at 1000 characters and counts as you type", () => {
    render(<FeedbackPanel entity="pitchcraft" />);
    fireEvent.click(screen.getByRole("button", { name: "Feature Request" }));
    const box = screen.getByLabelText("Your feedback") as HTMLTextAreaElement;
    expect(box.maxLength).toBe(MAX_FEEDBACK);
    fireEvent.change(box, { target: { value: "hello" } });
    expect(screen.getByText(`5/${MAX_FEEDBACK}`)).toBeInTheDocument();
  });

  it("posts the trimmed feedback for the entity and thanks the user", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ id: 1 }, true, 201)));
    global.fetch = fetchMock as typeof fetch;

    render(<FeedbackPanel entity="pitchcraft" />);
    fireEvent.click(screen.getByRole("button", { name: "Feature Request" }));
    fireEvent.change(screen.getByLabelText("Your feedback"), {
      target: { value: "  add more keys  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(await screen.findByText(/thanks for the feedback/i)).toBeInTheDocument();
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/feedback");
    expect(JSON.parse(opts.body as string)).toEqual({
      entity: "pitchcraft",
      text: "add more keys",
    });
  });

  it("disables submit until there is non-whitespace text", () => {
    render(<FeedbackPanel entity="pitchcraft" />);
    fireEvent.click(screen.getByRole("button", { name: "Feature Request" }));
    const submit = screen.getByRole("button", { name: "Submit" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Your feedback"), {
      target: { value: "   " },
    });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Your feedback"), {
      target: { value: "ok" },
    });
    expect(submit).toBeEnabled();
  });
});

describe("FeedbackPanel — vote on feedback", () => {
  const ITEMS = [
    { id: 11, text: "add a metronome", votes: 2 },
    { id: 22, text: "more tunes", votes: 5 },
    { id: 33, text: "darker theme", votes: 0 },
  ];

  it("loads three random items and requests them for the entity", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(ITEMS)));
    global.fetch = fetchMock as typeof fetch;

    render(<FeedbackPanel entity="pitchcraft" />);
    fireEvent.click(screen.getByRole("button", { name: "Vote on feature requests" }));

    expect(await screen.findByText("add a metronome")).toBeInTheDocument();
    expect(screen.getByText("more tunes")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/feedback/random?entity=pitchcraft");
  });

  it("upvotes an item, records it in localStorage, and disables re-voting", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (typeof url === "string" && url.includes("/vote")) {
        return Promise.resolve(jsonResponse({ id: 11, votes: 3 }));
      }
      return Promise.resolve(jsonResponse(ITEMS));
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<FeedbackPanel entity="pitchcraft" />);
    fireEvent.click(screen.getByRole("button", { name: "Vote on feature requests" }));

    const upBtn = await screen.findByRole("button", { name: "Upvote (2)" });
    fireEvent.click(upBtn);

    expect(await screen.findByRole("button", { name: "Voted (3)" })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledWith("/api/feedback/11/vote", {
      method: "POST",
    });
    expect(JSON.parse(localStorage.getItem("feedback_voted") ?? "[]")).toContain(11);
  });

  it("does not offer a vote for an item already voted in a previous session", async () => {
    localStorage.setItem("feedback_voted", JSON.stringify([22]));
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse(ITEMS))) as typeof fetch;

    render(<FeedbackPanel entity="pitchcraft" />);
    fireEvent.click(screen.getByRole("button", { name: "Vote on feature requests" }));

    expect(await screen.findByRole("button", { name: "Voted (5)" })).toBeDisabled();
  });

  it("shows a friendly empty state when there is no feedback", async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse([]))) as typeof fetch;
    render(<FeedbackPanel entity="pitchcraft" />);
    fireEvent.click(screen.getByRole("button", { name: "Vote on feature requests" }));
    expect(await screen.findByText(/be the first to leave some/i)).toBeInTheDocument();
  });

  it("surfaces a load error", async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse(null, false, 500))) as typeof fetch;
    render(<FeedbackPanel entity="pitchcraft" />);
    fireEvent.click(screen.getByRole("button", { name: "Vote on feature requests" }));
    await waitFor(() => expect(screen.getByText(/could not load feedback/i)).toBeInTheDocument());
  });
});
