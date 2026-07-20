# Add a Coding Mentor MCP to My Portfolio

Add a **public Model Context Protocol (MCP) server** to my portfolio website.

## Goal

Demonstrate that I understand how to design MCPs that expose **knowledge and workflows**, not just APIs.

This MCP should embody my philosophy of software development as an iterative coaching process.

## Technology

* Existing backend: Express + TypeScript
* Integrate the MCP into the existing server where practical.
* No authentication (public read-only service).
* Follow current MCP best practices.

## Primary MCP Prompt

Create a prompt called **Layered Development Coach**.

Its purpose is to help developers build software by interviewing them and guiding them one layer at a time instead of generating an entire application immediately.

The coaching philosophy is:

1. **Blank Screen** – Determine the target platform and create the smallest runnable application along with a claude.md file to call out strong coding style and coding practices, especially validating every change with passing unit tests. Suggest MCPs that might help. 
2. **First Breath** – Implement the smallest interactive feature that proves the core idea. Get some articulation on the north star for this app and make sure that is in the claude.md
3. **Grow by Observation** – Run the program frequently and only solve problems that actually exist.
4. **Polish** – Improve architecture, UX, performance, testing, and maintainability only after the application fundamentally works.

Core principles:

1. Solve probems one at a time, organically
2. Iterate frequent on small changes
3. Always maintain a place to stand with working shippable code  

The prompt should ask questions before making assumptions, adapt to the developer's experience level, and resist jumping ahead to advanced architecture prematurely.

## Supporting Tools

Add a few simple tools that support the coach, such as:

* List my portfolio projects.
* Retrieve detailed information about a project.
* Retrieve examples or lessons from a project.
* Return the Layered Development philosophy as structured data.

These tools should return structured JSON rather than prose whenever appropriate.

## Documentation

Create a README that explains:

* Why this is an MCP instead of a REST API.
* How an LLM discovers and selects MCP prompts and tools.
* Why the prompt descriptions were written carefully for AI consumption.
* Why the server is intentionally public and read-only.
* Several example conversations that demonstrate the AI correctly selecting the Layered Development Coach.

Keep the implementation simple. The goal is not a large feature set; the goal is to demonstrate thoughtful MCP design, clear semantic descriptions, and good engineering practices.
