#!/usr/bin/env node
// VPS ops MCP server for the portfolio.
//
// Gives Claude read-only visibility into the production VPS over SSH: service
// health, PM2 process status, and recent logs — so pre/post-deploy checks can
// happen from inside a session instead of hand-SSHing. It only RUNS remote
// read commands (curl health, `pm2 jlist`, `pm2 logs --nostream`); it never
// deploys or restarts anything.
//
// Wired up via the repo's .mcp.json (stdio transport). Connection is
// configurable via env (defaults match this repo's VPS):
//   PORTFOLIO_SSH_HOST  (default root@198.71.56.24)
//   PORTFOLIO_SSH_KEY   (default ~/.ssh/id_ed25519_portfolio)
// The private key never leaves your machine — only its path is referenced.

import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const HOST = process.env.PORTFOLIO_SSH_HOST ?? "root@198.71.56.24";
const KEY =
  process.env.PORTFOLIO_SSH_KEY ?? path.join(os.homedir(), ".ssh", "id_ed25519_portfolio");

/** The PM2 services and the ports they serve /api/health on. */
const SERVICES = [
  { name: "ericjorgensen", port: 3001 },
  { name: "pixelwhimsy", port: 3002 },
  { name: "thejcrew", port: 3003 },
  { name: "bigtinygames", port: 3004 },
  { name: "feedback", port: 3005 },
];

/** Run a single remote command over SSH; resolves with {ok, out}. Never throws. */
function sshExec(remoteCmd, timeoutMs = 25000) {
  return new Promise((resolve) => {
    const args = [
      "-i", KEY,
      "-o", "BatchMode=yes",
      "-o", "ConnectTimeout=10",
      "-o", "StrictHostKeyChecking=accept-new",
      HOST,
      remoteCmd,
    ];
    execFile(
      "ssh",
      args,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const out = (stdout || "").trim();
        if (err && !out) resolve({ ok: false, out: (stderr || err.message).trim() });
        else resolve({ ok: true, out, err: (stderr || "").trim() });
      },
    );
  });
}

const TOOLS = [
  {
    name: "health_check",
    description:
      "Curl /api/health on every PM2 service (ports 3001-3005) on the VPS and report each HTTP status. Also checks that the feedback admin API rejects unauthenticated requests (expects 401).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "pm2_status",
    description: "Report each PM2 process on the VPS: status, restarts, CPU and memory.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "tail_log",
    description: "Show the most recent PM2 log lines for a service on the VPS.",
    inputSchema: {
      type: "object",
      properties: {
        service: {
          type: "string",
          description: "PM2 service name, e.g. bigtinygames, feedback, ericjorgensen.",
        },
        lines: { type: "number", description: "How many recent lines (default 40)." },
      },
      required: ["service"],
      additionalProperties: false,
    },
  },
];

const text = (s) => ({ content: [{ type: "text", text: s }] });

async function healthCheck() {
  const ports = SERVICES.map((s) => s.port).join(" ");
  const cmd =
    `for p in ${ports}; do ` +
    `echo "$p $(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:$p/api/health)"; done; ` +
    `echo "admin $(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:3005/api/admin/feedback)"`;
  const { ok, out } = await sshExec(cmd);
  if (!ok) return text(`SSH failed: ${out}`);
  const code = Object.fromEntries(out.split("\n").map((l) => l.trim().split(/\s+/)));
  const lines = SERVICES.map((s) => {
    const c = code[String(s.port)] ?? "000";
    return `${c === "200" ? "OK  " : "FAIL"} ${s.name.padEnd(14)} :${s.port} -> ${c}`;
  });
  const admin = code["admin"] ?? "000";
  lines.push(`${admin === "401" ? "OK  " : "FAIL"} feedback-admin  gated -> ${admin} (expect 401)`);
  return text(lines.join("\n"));
}

async function pm2Status() {
  const { ok, out } = await sshExec("pm2 jlist");
  if (!ok) return text(`SSH failed: ${out}`);
  let procs;
  try {
    procs = JSON.parse(out);
  } catch {
    return text(out); // fall back to raw output if jlist wasn't JSON
  }
  const rows = procs.map((p) => {
    const e = p.pm2_env ?? {};
    const mem = Math.round((p.monit?.memory ?? 0) / 1048576);
    return `${(e.status ?? "?").padEnd(9)} ${String(p.name).padEnd(16)} restarts=${e.restart_time ?? 0} cpu=${p.monit?.cpu ?? 0}% mem=${mem}MB`;
  });
  return text(rows.join("\n") || "(no PM2 processes)");
}

async function tailLog(args) {
  const service = String(args.service ?? "");
  if (!/^[A-Za-z0-9._-]+$/.test(service)) return text("Invalid service name.");
  const lines = Number.isFinite(args.lines) ? Math.max(1, Math.min(500, Math.floor(args.lines))) : 40;
  const { ok, out } = await sshExec(`pm2 logs ${service} --lines ${lines} --nostream`, 30000);
  return text(ok ? out || "(no output)" : `SSH failed: ${out}`);
}

const server = new Server(
  { name: "portfolio-ops", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  try {
    if (name === "health_check") return await healthCheck();
    if (name === "pm2_status") return await pm2Status();
    if (name === "tail_log") return await tailLog(args);
    throw new Error(`Unknown tool: ${name}`);
  } catch (err) {
    return { isError: true, content: [{ type: "text", text: `Error: ${err.message}` }] };
  }
});

await server.connect(new StdioServerTransport());
