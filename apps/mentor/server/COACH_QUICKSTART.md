# Getting Started with the Layered Development Coach MCP

A guide for new users discovering and using the Layered Development Coach.

## 1. **What is this MCP?**

The Layered Development Coach is a Model Context Protocol server that guides you through building software iteratively. Instead of asking for a full application, it interviews you and builds one *layer at a time* — starting with the smallest runnable code, then adding interactivity, then iterating on real problems.

**Why MCP instead of a chat prompt?** The coach can access your project history and lessons learned from my portfolio projects, so it gives tailored advice based on proven patterns — not generic suggestions.

## 2. **Connect the MCP to Claude**

### If you're using Claude Code or Claude Desktop:

1. Get the MCP endpoint from the portfolio website (`https://ericjorgensen.com/api/mcp`).
2. Add it to your Claude client's MCP configuration:
   - **Claude Desktop**: Edit `claude_desktop_config.json` and add:
     ```json
     "mentor": {
       "url": "sse://ericjorgensen.com/api/mcp"
     }
     ```
   - **Claude Code**: Use `/config` and add it under `mcpServers`.
3. Restart Claude and verify the connection.

### If you're using Claude.ai (web):

The MCP may be available through integrations if your workspace has it enabled. Ask your administrator or check Settings → Integrations.

## 3. **Invoke the Coach**

Once connected, start a conversation with Claude and mention one of these to trigger the coach:

- **"I want to build [idea]. Use the Layered Development Coach."**
- **"Help me start a new project using the coach methodology."**
- **"/layered-development-coach [your project idea]"** (if the MCP exposes a slash command)

Claude will automatically load the coach prompt and start interviewing you.

## 4. **What to Expect in the First Session**

### Phase 1: Blank Screen
The coach will ask:
- What platform? (web, CLI, mobile, etc.)
- What's the core idea in one sentence?
- Have you built something like this before?

Then it will:
- Create the smallest runnable app in your chosen language
- Write a `CLAUDE.md` file with coding standards and testing practices
- Suggest relevant MCPs or tools that might help

**Your job:** Get the app running locally and confirm it works.

### Phase 2: First Breath
- Implement one small feature that proves the core idea works
- Refine the "north star" description in `CLAUDE.md`
- Keep the app runnable and shippable at every step

### Phase 3: Grow by Observation
- Run the app frequently — test it by hand
- Only fix problems that *actually exist*, not theoretical ones
- Add features organically as you discover needs

### Phase 4: Polish
- Improve architecture, UX, performance, testing only *after* the app works
- No premature abstraction or optimization

## 5. **Using the Coach's Tools**

During a session, the coach can:

- **List my portfolio projects** — to find examples and patterns
- **Fetch project details** — to explain why choices were made
- **Share lessons learned** — to help you avoid pitfalls
- **Return the coaching philosophy as JSON** — so you can review principles

The coach will use these tools automatically when relevant; you don't need to invoke them directly.

## 6. **Tips for Best Results**

1. **Be honest about your experience level.** The coach adapts to you — be clear about what you know and what you don't.
2. **Commit your code frequently.** Each small change, each passing test — this is how you "maintain a place to stand."
3. **Run the app, don't just read the code.** The coach will ask you to test things manually; this catches issues static analysis misses.
4. **Resist jumping ahead.** When the coach says "small feature," push back if you're tempted to add 10 things. One feature per cycle.
5. **Use the feedback loop.** After each phase, tell the coach what worked and what didn't — it adapts the next phase accordingly.

## 7. **When to Bring in Other Tools**

The coach can suggest MCPs or Claude Code features mid-session:
- **`/code-review`** — get a second opinion on your changes
- **`/run`** — test the app in a sandbox
- **Anthropic API MCP** — if you're integrating Claude into your app
- **Database MCP** — if you need data persistence

The coach will tell you which to use and when.

## 8. **Troubleshooting**

| Problem | Solution |
|---------|----------|
| "Coach not responding" | Verify the MCP is connected and Claude can see its tools. Try restarting Claude. |
| "It's generating too much code at once" | Remind the coach: *"I want smaller steps. Just one feature at a time."* |
| "The suggestions don't match my tech stack" | Tell the coach upfront: *"I'm building in [language/framework]. Assume I know [your experience]."* |
| "I want to revisit the north star" | Ask: *"Let's refresh the claude.md. Does the north star still match the app?"* |

## 9. **Example First Question**

> *"I want to build a small CLI tool that tracks daily habits — just a list you can add to, check off, and review. I know Python well. Use the Layered Development Coach."*

The coach will then:
1. Ask clarifying questions about your setup
2. Create a minimal Python CLI
3. Walk you through getting it running
4. Guide you to add one feature (maybe the "add habit" command)
5. Let you test it before moving on

## 10. **Learn More**

- Read the MCP server's **README** for philosophy and design choices
- Browse example conversations on the portfolio site
- Check my **project repository** for `CLAUDE.md` files in real projects — these embody the coaching principles

---

**Ready?** Start a conversation with Claude and tell it you want to use the Layered Development Coach. It'll take it from there.
