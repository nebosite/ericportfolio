# PixelWhimsy — App Instructions

These are app-specific notes for PixelWhimsy. The repo-wide `CLAUDE.md` (local
review before deploy, tests for every change, deployment guards, the standard
feedback feature) still applies on top of this.

## What this app is (the North Star)

PixelWhimsy turns whatever device it's running on — a phone, a tablet, a PC —
into a **software toy for a very young child**. The goal: a parent can hand the
device to a small child, walk away for a few minutes, and feel **reasonably
assured** that the child banging on the keyboard or tapping randomly is just
**playing**, not accidentally escaping the app and getting into the rest of the
computer.

So the North Star is two things at once:

1. **A safe sandbox** the child is unlikely to break out of.
2. **A delightful, creative toy** that engages the child's imagination.

Get a child happily absorbed, in a place where they can't cause harm, and you've
given a parent a little respite they can feel good about. Every decision in this
app serves that.

## The prime directive: containment

**Assume the user is a toddler mashing keys and tapping the screen at random.**
That isn't an edge case to defend against — it's the primary user. Treat
"random input" as the expected input, and make sure it only ever produces more
play, never an exit or a path to mischief.

Concretely, when building anything here:

- **Swallow input that would leave or disrupt the app.** Capture keyboard input
  and `preventDefault()` rather than letting keystrokes drive the browser/OS.
  Every key should mean "play," never "navigate."
- **Kill the browser's escape hatches.** Suppress the context menu
  (right-click / long-press), pinch/double-tap zoom, text selection, image
  drag, pull-to-refresh and overscroll. Reach for `touch-action: none`,
  `user-select: none`, `overscroll-behavior: none`, and preventing default on
  gesture events. The canvas should feel like a solid toy, not a web page.
- **No accidental exits.** There should be no link, button, or gesture a random
  tap can hit that navigates away, opens a new tab, starts a download, or leaves
  the toy. If an intentional exit is ever needed, gate it behind something a
  small child won't do by accident (a deliberate hold, a parent-only gesture).
- **Nothing reachable by random input is destructive or irreversible** in a way
  that matters. Clearing the screen is fine and playful; losing something the
  child cares about, or doing anything the parent would be unhappy about, is not.
- **No way out to harm.** No external links, no purchases, no account flows, no
  ads — nothing that leads a child out of the sandbox.

When in doubt, ask: _if a two-year-old slapped the screen and keyboard for thirty
seconds straight, could they end up anywhere other than still playing in
PixelWhimsy?_ If yes, that's a bug.

## The feeling: play

The other half is just as important — the sandbox has to be **fun**.

- It **starts like a painting program, but quirky and different.** It is a toy,
  not a tool: favor delight, surprise, and discovery over precision or utility.
- It's **interactive and alive.** Beyond painting, there are **modes that affect
  all the pixels on the screen** at once — the whole canvas reacts.
- It's a **growing toybox.** Over time we add lots of little tools and devices a
  child can play with and poke at. Each new toy should:
  - be understandable by a **pre-literate** child — lean on visuals, motion, and
    sound, not text or instructions;
  - reward **random** interaction (tapping, dragging, mashing) with something
    delightful, never an error or a dead end;
  - use **big, forgiving** touch targets and respond to touch, mouse, and keys;
  - stay **self-contained** and respect the containment rules above.

## Where things live

- `client/src/components/PixelCanvas.tsx` — the core paint surface (the current
  toy). New tools/devices and screen-wide modes hang off this.
- `client/src/pages/HomePage.tsx` — the title screen (logo, tagline, and the
  standard parent-facing feedback panel).
- `server/` — health-only; PixelWhimsy keeps no per-app data. (Feedback is owned
  by the shared feedback service — see the repo-root `CLAUDE.md`.)

## How to evaluate a change here

A feature is done when it is both **fun** and **contained**: it adds play, and a
child cannot use it (or abuse it) to leave the toy or cause harm. Verify the
containment behaviors by actually trying to break out — random taps, every key,
right-click, pinch, swipe from the edges — not just by reading the code.
