import { describe, it, expect } from "vitest";
import { LAYERED_DEVELOPMENT, philosophyAsStructuredData } from "./philosophy";
import { PROJECTS, listProjects, getProject, getProjectLessons } from "./projects";
import { buildCoachPrompt, COACH_PROMPT } from "./coach";

describe("philosophy", () => {
  it("has the four layers in order with purpose + exit criteria", () => {
    const p = philosophyAsStructuredData();
    expect(p.layers.map((l) => l.name)).toEqual([
      "Blank Screen",
      "First Breath",
      "Grow by Observation",
      "Polish",
    ]);
    expect(p.layers.map((l) => l.order)).toEqual([1, 2, 3, 4]);
    for (const l of p.layers) {
      expect(l.purpose.length).toBeGreaterThan(0);
      expect(l.exitCriteria.length).toBeGreaterThan(0);
      expect(l.practices.length).toBeGreaterThan(0);
    }
  });

  it("carries the three core principles", () => {
    expect(LAYERED_DEVELOPMENT.principles).toHaveLength(3);
    expect(LAYERED_DEVELOPMENT.principles.join(" ").toLowerCase()).toContain("shippable");
  });
});

describe("projects", () => {
  it("lists projects with unique ids and required fields", () => {
    const list = listProjects();
    expect(list.length).toBeGreaterThan(0);
    const ids = list.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length); // unique
    for (const p of list) {
      expect(p.name).toBeTruthy();
      expect(p.category).toBeTruthy();
      expect(p.summary).toBeTruthy();
    }
  });

  it("returns full detail for a known id and null for an unknown one", () => {
    expect(getProject("big-robo-tiny-tron")?.name).toBe("Big Robo Tiny Tron");
    expect(getProject("does-not-exist")).toBeNull();
  });

  it("flattens lessons, each tied to a valid layer, filterable by project", () => {
    const layers = LAYERED_DEVELOPMENT.layers.map((l) => l.name);
    const all = getProjectLessons();
    expect(all.length).toBeGreaterThan(0);
    for (const l of all) expect(layers).toContain(l.layer);
    const scoped = getProjectLessons("feedback-service");
    expect(scoped.length).toBeGreaterThan(0);
    expect(scoped.every((l) => l.projectId === "feedback-service")).toBe(true);
  });

  it("every project's lessons reference a real layer", () => {
    const layers = new Set(LAYERED_DEVELOPMENT.layers.map((l) => l.name));
    for (const p of PROJECTS) for (const l of p.lessons) expect(layers.has(l.layer)).toBe(true);
  });
});

describe("layered_development_coach prompt", () => {
  it("advertises itself for AI selection (name + intent in the description)", () => {
    expect(COACH_PROMPT.name).toBe("layered_development_coach");
    const d = COACH_PROMPT.description.toLowerCase();
    expect(d).toContain("one layer at a time");
    expect(d).toContain("instead of generating a whole application");
  });

  it("returns a single user message embedding the method", () => {
    const { messages } = buildCoachPrompt();
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    const text = messages[0].content.text;
    for (const name of ["Blank Screen", "First Breath", "Grow by Observation", "Polish"]) {
      expect(text).toContain(name);
    }
    expect(text).toContain("claude.md");
  });

  it("weaves in the idea and experience when provided", () => {
    const { messages, description } = buildCoachPrompt({
      idea: "a tide-clock for my desk",
      experience: "beginner",
    });
    const text = messages[0].content.text;
    expect(text).toContain("a tide-clock for my desk");
    expect(text).toContain("beginner");
    expect(description).toContain("a tide-clock for my desk");
  });

  it("asks for experience level when it is not provided", () => {
    const text = buildCoachPrompt({ idea: "something" }).messages[0].content.text;
    expect(text.toLowerCase()).toContain("experience level");
  });
});
