# Claude Code — Project Instructions

## Workflow: local review before deploy

**For every change:** build and run the affected site locally so the user can
review it in a browser before committing to git or deploying to the VPS.

Steps:
1. Make the code change.
2. `npm run dev` (or `npm run build` + preview) in the affected app's `client/` directory.
3. Tell the user the local URL and ask them to check it.
4. Only after approval: `git commit`, `git push`, then deploy via `deploy.sh` or the
   SSH one-liner used in previous sessions.
