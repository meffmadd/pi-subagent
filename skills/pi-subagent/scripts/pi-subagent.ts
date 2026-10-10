#!/usr/bin/env node
// Each run directory shares its UUID with a persisted Pi session for follow-ups.
// Worker stdout/stderr go directly to files so the launcher can exit immediately.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

type Status = "running" | "settled" | "aborted" | "failed" | "empty";

interface Step {
  tool: string;
  summary: string;
  isError: boolean;
  durationMs: number | null;
  done: boolean;
}

interface RunState {
  status: Status;
  turns: number;
  toolCalls: number;
  tokens: number;
  cost: number;
  model: string | null;
  lastTool: string | null;
  lastActivity: string | null;
  errorMessage: string | null;
  text: string | null;
  steps: Step[];
  inFlight: boolean;
}

const USAGE = `pi-subagent — spawn, inspect, and wait for Pi subagent runs

A subagent is a child \`pi\` process with a fresh context. \`spawn\` starts one in
the background. The worker's session persists in the project's session store;
spawn pre-generates its uuid, so the run dir (/tmp/pi-subagents/<session-id>)
exists before pi starts and is named by the session id:

  <run-dir>/
    events.jsonl      live JSON event stream from \`pi --mode json\`
    pid               worker process id
    stderr.log        worker stderr
    spawn.json        project cwd and tools, for resume

The remaining commands take the run directory printed by spawn.
resume forks a run's persisted session into a fresh run dir beside it and
continues it in the background, printing the new run dir. The worker keeps the
session's context, model, and reasoning level (override with --model and
--thinking); without MSG it is told to resume where it stopped. resume refuses
while the run's process is alive.
Pass @path as a task argument to include a task file.

Usage:
  pi-subagent spawn [options] -- TASK   start a background subagent; prints its run dir
  pi-subagent resume <run-dir> [options] [MSG...]
                                      continue a run's session in a new background run
  pi-subagent state  <run-dir>           one-line JSON run summary
  pi-subagent steps  <run-dir>           tool calls so far, with duration and status
  pi-subagent text   <run-dir>           latest completed assistant text
  pi-subagent result <run-dir>           final text (settled runs only)
  pi-subagent wait   <run-dir> [options] block until settled or the run's process exits

Spawn options:
  --dir <path>      run-dir parent (default /tmp/pi-subagents)
  --tools <list>    comma-separated tool allowlist (default read,grep,find,ls)
  --thinking <lvl>  off | minimal | low | medium | high | xhigh | max
  --model <pattern> model pattern or id

Resume options:
  --tools <list>    tool allowlist (default: the run's spawn.json tools, else read,grep,find,ls)
  --thinking <lvl>  override the session's reasoning level
  --model <pattern> override the session's model

Wait options:
  --pid <id>        process id; stop as soon as it is gone (read automatically from a run dir)
  --timeout <s>     give up after <s> seconds (default 600, 0 = wait forever)
  --interval <s>    poll interval in seconds (default 2)

Statuses: running · settled · aborted · failed · empty
Exit codes: 0 settled · 1 usage · 2 not found/unreadable · 3 wait timeout · 4 failed, aborted, or
            the process exited without settling`;

const DEFAULT_BASE = "/tmp/pi-subagents";
const DEFAULT_TOOLS = "read,grep,find,ls";
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const DEFAULT_RESUME_MESSAGE =
  "Your previous run ended before finishing. Resume exactly where you stopped — check the worktree for partial progress, then finish the task.";

function fail(msg: string, code: number): never {
  console.error(`pi-subagent: ${msg}`);
  process.exit(code);
}

function parseRecords(file: string): any[] {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return fail(`cannot read ${file}`, 2);
  }
  const records: any[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed));
    } catch {
      // A torn final line while the file is still being written; skip it.
    }
  }
  return records;
}

function textOf(message: any): string | null {
  if (!message || !Array.isArray(message.content)) return null;
  const parts: string[] = [];
  for (const block of message.content) {
    if (block?.type === "text" && typeof block.text === "string") parts.push(block.text);
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

function modelOf(message: any): string | null {
  if (!message?.model) return null;
  return message.provider ? `${message.provider}/${message.model}` : String(message.model);
}

function summarize(tool: string, args: any): string {
  const a = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const pick = (key: string): string | null => (typeof a[key] === "string" ? (a[key] as string) : null);
  let s: string | null = null;
  if (tool === "bash") s = pick("command");
  if (!s) {
    for (const key of ["path", "pattern", "glob", "url", "query", "name"]) {
      const v = pick(key);
      if (v) {
        s = `${key}=${v}`;
        break;
      }
    }
  }
  if (!s) {
    const first = Object.entries(a)[0];
    if (first) {
      s = `${first[0]}=${typeof first[1] === "string" ? first[1] : JSON.stringify(first[1])}`;
    }
  }
  if (!s) return "";
  s = s.replace(/\s+/g, " ").trim();
  return s.length > 58 ? `${s.slice(0, 57)}…` : s;
}

function readState(file: string): RunState {
  const records = parseRecords(file);
  const steps: Step[] = [];
  const openSteps = new Map<string, Step>();
  let turns = 0;
  let tokens = 0;
  let cost = 0;
  let lastAssistant: any = null;
  let settled = false;
  let aborted = false;
  let lastMs = 0;

  const addUsage = (u: any): void => {
    if (!u) return;
    tokens += u.totalTokens ?? 0;
    cost += u.cost?.total ?? 0;
  };

  for (const r of records) {
    switch (r?.type) {
      case "message_end": {
        const m = r.message;
        if (!m) break;
        if (typeof m.timestamp === "number" && m.timestamp > lastMs) lastMs = m.timestamp;
        if (m.role === "assistant") {
          turns++;
          lastAssistant = m;
          addUsage(m.usage);
        } else if (m.role === "toolResult") {
          addUsage(m.usage);
        }
        break;
      }
      case "tool_execution_start": {
        const step: Step = {
          tool: r.toolName ?? "?",
          summary: summarize(r.toolName, r.args),
          isError: false,
          durationMs: null,
          done: false,
        };
        steps.push(step);
        if (r.toolCallId) openSteps.set(r.toolCallId, step);
        break;
      }
      case "tool_execution_end": {
        const step = r.toolCallId ? openSteps.get(r.toolCallId) : undefined;
        if (step) {
          step.done = true;
          step.isError = !!r.isError;
          step.durationMs = typeof r.durationMs === "number" ? r.durationMs : null;
          openSteps.delete(r.toolCallId);
        } else {
          steps.push({
            tool: r.toolName ?? "?",
            summary: summarize(r.toolName, r.args),
            isError: !!r.isError,
            durationMs: typeof r.durationMs === "number" ? r.durationMs : null,
            done: true,
          });
        }
        break;
      }
      case "agent_settled":
        settled = true;
        aborted = !!r.aborted;
        break;
    }
  }

  let status: Status;
  if (aborted) status = "aborted";
  else if (lastAssistant?.stopReason === "error") status = "failed";
  else if (settled) status = "settled";
  else if (records.length === 0) status = "empty";
  else status = "running";

  return {
    status,
    turns,
    toolCalls: steps.length,
    tokens,
    cost,
    model: modelOf(lastAssistant),
    lastTool: steps.length > 0 ? steps[steps.length - 1].tool : null,
    lastActivity: lastMs ? new Date(lastMs).toISOString() : null,
    errorMessage: lastAssistant?.errorMessage ?? null,
    text: textOf(lastAssistant),
    steps,
    inFlight: openSteps.size > 0,
  };
}

// ---------------------------------------------------------------------------
// spawn
// ---------------------------------------------------------------------------

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err?.code === "EPERM";
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function stderrTail(path: string, maxChars = 2000): string {
  try {
    const text = readFileSync(path, "utf8").trim();
    return text.length > maxChars ? text.slice(-maxChars) : text;
  } catch {
    return "";
  }
}

function reportStderr(runDir: string): void {
  const tail = stderrTail(join(runDir, "stderr.log"));
  if (tail) console.error(`pi-subagent: worker stderr:\n${tail}`);
}

async function cmdSpawn(flags: Record<string, string>, taskArgs: string[]): Promise<void> {
  if (flags.thinking !== undefined && !THINKING_LEVELS.includes(flags.thinking)) {
    fail(`--thinking must be one of: ${THINKING_LEVELS.join(", ")}`, 1);
  }

  const task = taskArgs.filter((t) => t.length > 0);
  if (task.length === 0) fail("spawn needs a task (text or @file)", 1);

  const baseDir = flags.dir ?? DEFAULT_BASE;
  const sessionId = randomUUID();
  const runDir = join(baseDir, sessionId);
  try {
    mkdirSync(baseDir, { recursive: true });
    mkdirSync(runDir);
  } catch (err) {
    return fail(`cannot create ${runDir}: ${(err as Error).message}`, 1);
  }

  const tools = flags.tools ?? DEFAULT_TOOLS;
  writeSpawnJson(runDir, process.cwd(), tools);

  const piArgs: string[] = ["--mode", "json", "-p", "--session-id", sessionId, "--tools", tools];
  if (flags.thinking !== undefined) piArgs.push("--thinking", flags.thinking);
  if (flags.model !== undefined) piArgs.push("--model", flags.model);
  if (task.some((t) => t.startsWith("-"))) piArgs.push("--"); // let a task begin with "-"
  piArgs.push(...task);

  await launchWorker(runDir, piArgs, process.cwd());
}

function writeSpawnJson(runDir: string, cwd: string, tools: string): void {
  try {
    writeFileSync(join(runDir, "spawn.json"), `${JSON.stringify({ cwd, tools }, null, 2)}\n`);
  } catch (err) {
    fail(`cannot write spawn.json in ${runDir}: ${(err as Error).message}`, 1);
  }
}

async function launchWorker(runDir: string, piArgs: string[], cwd: string): Promise<void> {
  const eventsPath = join(runDir, "events.jsonl");
  const stderrPath = join(runDir, "stderr.log");
  let outFd: number;
  let errFd: number;
  try {
    outFd = openSync(eventsPath, "a");
    errFd = openSync(stderrPath, "a");
  } catch (err) {
    return fail(`cannot open run files in ${runDir}: ${(err as Error).message}`, 1);
  }

  const child = spawn("pi", piArgs, {
    cwd,
    stdio: ["ignore", outFd, errFd], // the kernel redirects; this process can exit at once
    detached: true, // own process group: survives this script and the calling shell
    env: { ...process.env, PI_SUBAGENT_CHILD: "1" },
  });
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
  } finally {
    closeSync(outFd);
    closeSync(errFd);
  }
  child.unref();

  const pid = child.pid;
  if (typeof pid !== "number") fail("pi spawned without a process id", 1);
  try {
    writeFileSync(join(runDir, "pid"), `${pid}\n`);
  } catch (err) {
    return fail(`cannot write pid file in ${runDir}: ${(err as Error).message}`, 1);
  }
  console.log(runDir);
}

// ---------------------------------------------------------------------------
// resume
// ---------------------------------------------------------------------------

function expandTilde(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

function findSessionFile(cwd: string, sessionId: string): string | null {
  // Mirrors pi's store layout: <agentDir>/sessions/--<cwd with separators dashed>--/<ts>_<id>.jsonl
  const agentDir = process.env.PI_CODING_AGENT_DIR
    ? expandTilde(process.env.PI_CODING_AGENT_DIR)
    : join(homedir(), ".pi", "agent");
  const slug = `--${resolve(cwd).replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  const storeDir = join(agentDir, "sessions", slug);
  let names: string[];
  try {
    names = readdirSync(storeDir);
  } catch {
    return null;
  }
  const name = names.find((n) => n.endsWith(`_${sessionId}.jsonl`));
  return name ? join(storeDir, name) : null;
}

function sessionCwdOf(file: string): string | null {
  for (const r of parseRecords(file)) {
    if (r?.type === "session" && typeof r.cwd === "string") return r.cwd;
  }
  return null;
}

async function cmdResume(runDir: string, flags: Record<string, string>, messageArgs: string[]): Promise<void> {
  if (flags.thinking !== undefined && !THINKING_LEVELS.includes(flags.thinking)) {
    fail(`--thinking must be one of: ${THINKING_LEVELS.join(", ")}`, 1);
  }
  const message = messageArgs.filter((m) => m.length > 0);

  // A live worker still owns its session; forking it now copies a moving target.
  // Wait for it to settle or exit first. (pi also auto-retries transient errors,
  // so an interrupted connection is rarely a reason to resume.)
  const pidFile = join(runDir, "pid");
  if (existsSync(pidFile)) {
    const pid = Number.parseInt(readFileSync(pidFile, "utf8").trim(), 10);
    if (Number.isFinite(pid) && alive(pid)) {
      return fail(`run's process ${pid} is still alive; wait for it to settle or exit first`, 4);
    }
  }

  const sessionId = basename(runDir); // a run dir is always named by its session id
  let meta: { cwd?: unknown; tools?: unknown } = {};
  const metaFile = join(runDir, "spawn.json");
  if (existsSync(metaFile)) {
    try {
      meta = JSON.parse(readFileSync(metaFile, "utf8"));
    } catch (err) {
      return fail(`cannot parse ${metaFile}: ${(err as Error).message}`, 2);
    }
  }
  const cwd = typeof meta.cwd === "string" ? meta.cwd : sessionCwdOf(join(runDir, "events.jsonl"));
  if (!cwd) fail(`cannot determine the project of run ${runDir} (no spawn.json, no session record)`, 2);
  const tools = flags.tools ?? (typeof meta.tools === "string" ? meta.tools : DEFAULT_TOOLS);

  // The fork source must exist: pi would otherwise fork from nothing and the
  // worker would restart context-free instead of resuming.
  const sessionFile = findSessionFile(cwd, sessionId);
  if (!sessionFile) fail(`session ${sessionId} not found in the store for ${cwd}; nothing to resume`, 2);

  const newSessionId = randomUUID();
  const newRunDir = join(dirname(runDir), newSessionId);
  try {
    mkdirSync(newRunDir);
  } catch (err) {
    return fail(`cannot create ${newRunDir}: ${(err as Error).message}`, 1);
  }
  writeSpawnJson(newRunDir, cwd, tools);

  const piArgs: string[] = [
    "--mode", "json", "-p", "--session-id", newSessionId, "--fork", sessionFile, "--tools", tools,
  ];
  if (flags.thinking !== undefined) piArgs.push("--thinking", flags.thinking);
  if (flags.model !== undefined) piArgs.push("--model", flags.model);
  if (message.some((m) => m.startsWith("-"))) piArgs.push("--"); // let a message begin with "-"
  piArgs.push(...(message.length > 0 ? message : [DEFAULT_RESUME_MESSAGE]));

  await launchWorker(newRunDir, piArgs, cwd);
}

// ---------------------------------------------------------------------------
// state · steps · text · result
// ---------------------------------------------------------------------------

function describeFailure(s: RunState): string {
  const detail = s.errorMessage ?? (s.text ? s.text.slice(0, 300) : null);
  return `run ${s.status}${detail ? `: ${detail}` : " (no error detail)"}`;
}

function cmdState(file: string): void {
  const s = readState(file);
  const out: Record<string, unknown> = {
    status: s.status,
    turns: s.turns,
    toolCalls: s.toolCalls,
    tokens: s.tokens,
    cost: Math.round(s.cost * 1e6) / 1e6,
  };
  if (s.model) out.model = s.model;
  if (s.lastTool) out.lastTool = s.lastTool;
  if (s.lastActivity) out.lastActivity = s.lastActivity;
  if (s.inFlight) out.inFlight = true;
  if (s.errorMessage) out.errorMessage = s.errorMessage;
  console.log(JSON.stringify(out));
}

function cmdSteps(file: string): void {
  const s = readState(file);
  const bits = [
    `[${s.status}]`,
    `${s.turns} turns`,
    `${s.toolCalls} tool calls`,
    `${s.tokens} tokens`,
    `$${s.cost.toFixed(4)}`,
  ];
  if (s.model) bits.push(s.model);
  console.log(bits.join("  ·  "));
  if (s.steps.length === 0) {
    console.log("(no tool calls yet)");
    return;
  }
  s.steps.forEach((st, i) => {
    const head = `${String(i + 1).padStart(2)}. ${[st.tool, st.summary].filter(Boolean).join(" ")}`;
    const tail = st.done
      ? `${st.isError ? "ERR" : "ok"}${st.durationMs !== null ? ` ${st.durationMs}ms` : ""}`
      : "running…";
    const line = head.length >= 62 ? head.slice(0, 61) + "…" : head.padEnd(62);
    console.log(`${line}  ${tail}`);
  });
}

function cmdText(file: string): void {
  const s = readState(file);
  console.log(s.text ?? "(no assistant text yet)");
}

function cmdResult(file: string): void {
  const s = readState(file);
  if (s.status === "settled") {
    console.log(s.text ?? "(no assistant text)");
    return;
  }
  if (s.status === "failed" || s.status === "aborted") fail(describeFailure(s), 4);
  fail(`run is ${s.status} (turns=${s.turns}, toolCalls=${s.toolCalls}); inspect with steps/text`, 4);
}

// ---------------------------------------------------------------------------
// wait
// ---------------------------------------------------------------------------

async function cmdWait(file: string, flags: Record<string, string>, runDir: string): Promise<number> {
  let pid: number | null = null;
  if (flags.pid !== undefined && flags.pid !== "") {
    pid = Number.parseInt(flags.pid, 10);
    if (!Number.isFinite(pid)) fail("--pid needs a process id", 1);
  }
  let timeoutSec = 600;
  if (flags.timeout !== undefined) {
    timeoutSec = Number(flags.timeout);
    if (!Number.isFinite(timeoutSec) || timeoutSec < 0) fail("--timeout needs seconds (0 = no limit)", 1);
  }
  let intervalSec = 2;
  if (flags.interval !== undefined) {
    intervalSec = Number(flags.interval);
    if (!Number.isFinite(intervalSec) || intervalSec <= 0) fail("--interval needs positive seconds", 1);
  }
  const deadline = timeoutSec > 0 ? Date.now() + timeoutSec * 1000 : Infinity;

  for (;;) {
    if (existsSync(file)) {
      const s = readState(file);
      if (s.status === "settled") {
        console.log(s.text ?? "(no assistant text)");
        return 0;
      }
      if (s.status === "failed" || s.status === "aborted") {
        console.error(`pi-subagent: ${describeFailure(s)}`);
        console.error(`pi-subagent: to continue this run's session: pi-subagent resume ${runDir}`);
        return 4;
      }
    }
    if (pid !== null && !alive(pid)) {
      // Process gone; take a final look at whatever it wrote.
      if (existsSync(file)) {
        const s = readState(file);
        if (s.status === "settled") {
          console.log(s.text ?? "(no assistant text)");
          return 0;
        }
        console.error(`pi-subagent: process ${pid} exited with run status "${s.status}"`);
        reportStderr(runDir);
        console.error(`pi-subagent: to continue this run's session: pi-subagent resume ${runDir}`);
        return 4;
      }
      console.error(`pi-subagent: process ${pid} exited before writing ${file}`);
      reportStderr(runDir);
      console.error(`pi-subagent: to continue this run's session: pi-subagent resume ${runDir}`);
      return 4;
    }
    if (Date.now() > deadline) {
      fail(`timeout after ${timeoutSec}s (use --timeout to change; 0 = no limit)`, 3);
    }
    await sleep(intervalSec * 1000);
  }
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

function rejectFlags(flags: Record<string, string>, command: string, allowed: string[]): void {
  for (const key of Object.keys(flags)) {
    if (!allowed.includes(key)) fail(`--${key} is not a ${command} option`, 1);
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error(USAGE);
    process.exit(1);
  }
  if (argv[0] === "-h" || argv[0] === "--help" || argv[0] === "help") {
    console.log(USAGE);
    return;
  }

  const FLAG_NAMES = ["pid", "timeout", "interval", "dir", "tools", "thinking", "model"];
  const command = argv[0];
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith("--")) {
      const name = a.slice(2);
      if (!FLAG_NAMES.includes(name)) fail(`unknown option ${a}`, 1);
      const v = argv[++i];
      if (v === undefined) fail(`missing value for ${a}`, 1);
      flags[name] = v;
    } else {
      positional.push(a);
    }
  }

  if (command === "spawn") {
    rejectFlags(flags, command, ["dir", "tools", "thinking", "model"]);
    await cmdSpawn(flags, positional);
    return;
  }

  if (command === "resume") {
    rejectFlags(flags, command, ["tools", "thinking", "model"]);
    const [runDir, ...message] = positional;
    if (!runDir) fail("resume needs a run directory", 1);
    if (!existsSync(join(runDir, "events.jsonl"))) fail(`run directory ${runDir} has no events.jsonl`, 2);
    await cmdResume(runDir, flags, message);
    return;
  }

  const runDir = positional[0];
  if (!runDir) fail(`${command} needs a run directory`, 1);
  if (positional.length > 1) fail(`${command} takes one run directory`, 1);
  const file = join(runDir, "events.jsonl");
  if (!existsSync(file)) fail(`run directory ${runDir} has no events.jsonl`, 2);

  if (command === "wait") {
    rejectFlags(flags, command, ["pid", "timeout", "interval"]);
    if (flags.pid === undefined) {
      const pidFile = join(runDir, "pid");
      if (existsSync(pidFile)) flags.pid = readFileSync(pidFile, "utf8").trim();
    }
    const code = await cmdWait(file, flags, runDir);
    process.exit(code);
    return;
  }

  rejectFlags(flags, command, []);
  switch (command) {
    case "state":
      cmdState(file);
      break;
    case "steps":
      cmdSteps(file);
      break;
    case "text":
      cmdText(file);
      break;
    case "result":
      cmdResult(file);
      break;
    default:
      fail(`unknown command "${command}"`, 1);
  }
}

main().catch((err) => fail(String(err), 1));
