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

const FR = { name: /feature request/i };
const VOTE = { name: /vote on requests/i };

describe("FeedbackPanel — entry", () => {
  it("shows the two standard buttons", () => {
    render(<FeedbackPanel entity="snake" />);
    expect(screen.getByRole("button", FR)).toBeInTheDocument();
    expect(screen.getByRole("button", VOTE)).toBeInTheDocument();
  });

  it("does not let keystrokes reach window-level game controls", () => {
    const onWindowKey = vi.fn();
    window.addEventListener("keydown", onWindowKey);
    try {
      render(<FeedbackPanel entity="snake" />);
      fireEvent.click(screen.getByRole("button", FR));
      fireEvent.keyDown(screen.getByLabelText(/your feature request/i), { key: "ArrowUp" });
      fireEvent.keyDown(screen.getByLabelText(/your feature request/i), { key: " " });
      expect(onWindowKey).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", onWindowKey);
    }
  });
});

describe("FeedbackPanel — leave feedback", () => {
  it("caps the textarea at 1000 characters and counts as you type", () => {
    render(<FeedbackPanel entity="snake" />);
    fireEvent.click(screen.getByRole("button", FR));
    const box = screen.getByLabelText(/your feature request/i) as HTMLTextAreaElement;
    expect(box.maxLength).toBe(MAX_FEEDBACK);
    fireEvent.change(box, { target: { value: "hello" } });
    expect(screen.getByText(`5/${MAX_FEEDBACK}`)).toBeInTheDocument();
  });

  it("posts the trimmed feedback for the entity and thanks the user", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ id: 1 }, true, 201)));
    global.fetch = fetchMock as typeof fetch;

    render(<FeedbackPanel entity="snake" />);
    fireEvent.click(screen.getByRole("button", FR));
    fireEvent.change(screen.getByLabelText(/your feature request/i), {
      target: { value: "  great game  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(await screen.findByText(/thanks for the feedback/i)).toBeInTheDocument();
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/feedback");
    expect(JSON.parse(opts.body as string)).toEqual({ entity: "snake", text: "great game" });
  });

  it("after submitting, offers 'Submit another one?' (which resets the form) and 'Done'", async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse({ id: 1 }, true, 201))) as typeof fetch;

    render(<FeedbackPanel entity="snake" />);
    fireEvent.click(screen.getByRole("button", FR));
    fireEvent.change(screen.getByLabelText(/your feature request/i), { target: { value: "idea" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await screen.findByText(/thanks for the feedback/i);

    // "Submit another one?" reopens a fresh, empty form.
    fireEvent.click(screen.getByRole("button", { name: /submit another one/i }));
    const box = screen.getByLabelText(/your feature request/i) as HTMLTextAreaElement;
    expect(box.value).toBe("");
  });

  it("bug fix: 'Done' returns to the two main buttons (they don't disappear)", async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse({ id: 1 }, true, 201))) as typeof fetch;

    render(<FeedbackPanel entity="snake" />);
    fireEvent.click(screen.getByRole("button", FR));
    fireEvent.change(screen.getByLabelText(/your feature request/i), { target: { value: "idea" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await screen.findByText(/thanks for the feedback/i);

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByRole("button", FR)).toBeInTheDocument();
    expect(screen.getByRole("button", VOTE)).toBeInTheDocument();
  });

  it("shows a friendly message when the server rate-limits (429)", async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse(null, false, 429))) as typeof fetch;

    render(<FeedbackPanel entity="snake" />);
    fireEvent.click(screen.getByRole("button", FR));
    fireEvent.change(screen.getByLabelText(/your feature request/i), { target: { value: "idea" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByText(/submitted a lot of feedback/i)).toBeInTheDocument();
  });

  it("disables submit until there is non-whitespace text", () => {
    render(<FeedbackPanel entity="snake" />);
    fireEvent.click(screen.getByRole("button", FR));
    const submit = screen.getByRole("button", { name: "Submit" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/your feature request/i), { target: { value: "   " } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/your feature request/i), { target: { value: "ok" } });
    expect(submit).toBeEnabled();
  });
});

describe("FeedbackPanel — play nudge", () => {
  it("pops the nudge dialog when one is pending, and 'I have an idea' opens the form", () => {
    localStorage.setItem("nudge_pending_snake", "3");
    render(<FeedbackPanel entity="snake" />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /i have an idea/i }));
    expect(screen.getByLabelText(/your feature request/i)).toBeInTheDocument();
  });

  it("does not pop the dialog when no nudge is pending", () => {
    render(<FeedbackPanel entity="snake" />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("FeedbackPanel — vote on feedback", () => {
  const ITEMS = [
    { id: 11, text: "add a pause button", votes: 2 },
    { id: 22, text: "more levels", votes: 5 },
    { id: 33, text: "darker theme", votes: 0 },
  ];

  it("loads three random items and requests them for the entity", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(ITEMS)));
    global.fetch = fetchMock as typeof fetch;

    render(<FeedbackPanel entity="big-pac-tiny-man" />);
    fireEvent.click(screen.getByRole("button", VOTE));

    expect(await screen.findByText("add a pause button")).toBeInTheDocument();
    expect(screen.getByText("more levels")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/feedback/random?entity=big-pac-tiny-man");
  });

  it("upvotes an item, records it in localStorage, and disables re-voting", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (typeof url === "string" && url.includes("/vote")) {
        return Promise.resolve(jsonResponse({ id: 11, votes: 3 }));
      }
      return Promise.resolve(jsonResponse(ITEMS));
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<FeedbackPanel entity="snake" />);
    fireEvent.click(screen.getByRole("button", VOTE));

    const upBtn = await screen.findByRole("button", { name: "Upvote (2)" });
    fireEvent.click(upBtn);

    expect(await screen.findByRole("button", { name: "Voted (3)" })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledWith("/api/feedback/11/vote", { method: "POST" });
    expect(JSON.parse(localStorage.getItem("feedback_voted") ?? "[]")).toContain(11);
  });

  it("does not offer a vote for an item already voted in a previous session", async () => {
    localStorage.setItem("feedback_voted", JSON.stringify([22]));
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse(ITEMS))) as typeof fetch;

    render(<FeedbackPanel entity="snake" />);
    fireEvent.click(screen.getByRole("button", VOTE));

    expect(await screen.findByRole("button", { name: "Voted (5)" })).toBeDisabled();
  });

  it("shows a friendly empty state when there is no feedback", async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse([]))) as typeof fetch;
    render(<FeedbackPanel entity="snake" />);
    fireEvent.click(screen.getByRole("button", VOTE));
    expect(await screen.findByText(/be the first to leave one/i)).toBeInTheDocument();
  });

  it("surfaces a load error", async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse(null, false, 500))) as typeof fetch;
    render(<FeedbackPanel entity="snake" />);
    fireEvent.click(screen.getByRole("button", VOTE));
    await waitFor(() => expect(screen.getByText(/could not load feedback/i)).toBeInTheDocument());
  });
});
