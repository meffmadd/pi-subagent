import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../skills/pi-subagent/scripts/pi-subagent.ts", import.meta.url));

function fixture(t: TestContext) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-subagent-test-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  const run = join(root, "run");
  mkdirSync(bin);
  mkdirSync(run);
  writeFileSync(join(run, "events.jsonl"), "");
  const env = {
    ...process.env, PATH: bin, FAKE_PI_LOG: join(root, "calls.jsonl"), FAKE_PI_MODE: "settled",
    PI_CODING_AGENT_DIR: join(root, "agent"),
  };
  const invoke = (...args: string[]) => {
    const result = spawnSync(process.execPath, [CLI, ...args], {
      cwd: root, env, encoding: "utf8", timeout: 5000,
    });
    assert.ifError(result.error);
    return result;
  };
  const events = (...records: object[]) => writeFileSync(
    join(run, "events.jsonl"), records.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
  return { root, bin, run, env, invoke, events };
}

const assistant = (text: string, extra: object = {}) => ({
  type: "message_end",
  message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop", ...extra },
});
const settled = { type: "agent_settled", aborted: false };
const DEFAULT_RESUME_MESSAGE =
  "Your previous run ended before finishing. Resume exactly where you stopped — check the worktree for partial progress, then finish the task.";

// Mirrors the store lookup in the CLI: <agentDir>/sessions/--<cwd dashed>--/<ts>_<id>.jsonl
function makeSessionStore(root: string, run: string): string {
  const slug = `--${root.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  const dir = join(root, "agent", "sessions", slug);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `2026-01-01T00-00-00-000Z_${basename(run)}.jsonl`);
  writeFileSync(file, `{"type":"session","cwd":${JSON.stringify(root)}}\n`);
  return file;
}

function installFakePi(bin: string) {
  writeFileSync(join(bin, "pi"), `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_PI_LOG, JSON.stringify({args, cwd: process.cwd(), child: process.env.PI_SUBAGENT_CHILD}) + "\\n");
console.log(JSON.stringify({type: "agent_start"}));
if (process.env.FAKE_PI_MODE === "dead") {
  console.error("worker exploded");
} else {
  setTimeout(() => {
    console.log(JSON.stringify(${JSON.stringify(assistant("worker result"))}));
    console.log(JSON.stringify(${JSON.stringify(settled)}));
  }, 150);
}
`, { mode: 0o755 });
}

test("spawn launches Pi once, forwards @file and flags, and leaves a collectable run", (t) => {
  const f = fixture(t);
  installFakePi(f.bin);
  const spawned = f.invoke("spawn", "--dir", join(f.root, "runs"), "--tools", "read",
    "--thinking", "low", "--model", "example/model", "--", "@/tmp/task.md", "--task text");
  assert.equal(spawned.status, 0, spawned.stderr);
  const run = spawned.stdout.trim();
  const result = f.invoke("wait", run, "--interval", "0.01", "--timeout", "2");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "worker result\n");
  assert.match(readFileSync(join(run, "pid"), "utf8"), /^\d+\n$/);
  const calls = readFileSync(f.env.FAKE_PI_LOG, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    args: ["--mode", "json", "-p", "--session-id", basename(run), "--tools", "read",
      "--thinking", "low", "--model", "example/model", "--", "@/tmp/task.md", "--task text"],
    cwd: f.root, child: "1",
  });
  assert.equal(f.invoke("result", run).stdout, "worker result\n");
  assert.deepEqual(JSON.parse(readFileSync(join(run, "spawn.json"), "utf8")), { cwd: f.root, tools: "read" });
});

test("spawn errors are reported without printing a run directory", (t) => {
  const f = fixture(t);
  const result = f.invoke("spawn", "--dir", join(f.root, "runs"), "task");
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /spawn pi ENOENT/);
  assert.equal(f.invoke("spawn", "--dir", join(f.run, "events.jsonl"), "task").status, 1);
});

test("inspection accepts run directories, not session IDs or files; --task-file is gone", (t) => {
  const f = fixture(t);
  assert.equal(f.invoke("state", f.run).status, 0);
  for (const target of ["session-id", join(f.run, "events.jsonl"), join(f.root, "missing")]) {
    assert.equal(f.invoke("state", target).status, 2);
  }
  assert.equal(f.invoke("resume", "session-id").status, 2);
  const result = f.invoke("spawn", "--task-file", "task.md");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown option --task-file/);
});

test("state, steps, and text retain live progress while result requires settlement", (t) => {
  const f = fixture(t);
  assert.equal(JSON.parse(f.invoke("state", f.run).stdout).status, "empty");
  f.events({ type: "agent_start" }, assistant("progress", {
    provider: "provider", model: "model", timestamp: 1000,
    usage: { totalTokens: 12, cost: { total: 0.001 } },
  }), { type: "tool_execution_start", toolCallId: "call", toolName: "read", args: { path: "file.ts" } });
  appendFileSync(join(f.run, "events.jsonl"), '{"type":');
  assert.deepEqual(JSON.parse(f.invoke("state", f.run).stdout), {
    status: "running", turns: 1, toolCalls: 1, tokens: 12, cost: 0.001,
    model: "provider/model", lastTool: "read", lastActivity: "1970-01-01T00:00:01.000Z", inFlight: true,
  });
  assert.match(f.invoke("steps", f.run).stdout, /read path=file\.ts.*running…/);
  assert.equal(f.invoke("text", f.run).stdout, "progress\n");
  assert.equal(f.invoke("result", f.run).status, 4);
  f.events(assistant("final"), {
    type: "tool_execution_start", toolCallId: "call", toolName: "read", args: { path: "file.ts" },
  }, { type: "tool_execution_end", toolCallId: "call", isError: true, durationMs: 25 }, settled);
  assert.match(f.invoke("steps", f.run).stdout, /ERR 25ms/);
  assert.equal(f.invoke("result", f.run).stdout, "final\n");
});

test("failed and aborted runs reject collection", (t) => {
  const f = fixture(t);
  for (const records of [
    [assistant("", { stopReason: "error", errorMessage: "bad model" }), settled],
    [assistant("partial"), { ...settled, aborted: true }],
  ]) {
    f.events(...records);
    for (const command of ["result", "wait"]) {
      const result = f.invoke(command, f.run);
      assert.equal(result.status, 4);
      assert.match(result.stderr, /run (failed|aborted)/);
    }
    assert.match(f.invoke("wait", f.run).stderr, /pi-subagent resume /);
  }
});

test("wait detects a dead worker using its saved PID and reports stderr", (t) => {
  const f = fixture(t);
  installFakePi(f.bin);
  f.env.FAKE_PI_MODE = "dead";
  const spawned = f.invoke("spawn", "--dir", join(f.root, "runs"), "task");
  assert.equal(spawned.status, 0, spawned.stderr);
  const result = f.invoke("wait", spawned.stdout.trim(), "--interval", "0.01", "--timeout", "2");
  assert.equal(result.status, 4, result.stderr);
  assert.match(result.stderr, /exited with run status "running"/);
  assert.match(result.stderr, /worker exploded/);
  assert.match(result.stderr, /pi-subagent resume /);
});

test("wait retains timeout and option validation", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.run, "pid"), String(process.pid));
  assert.equal(f.invoke("wait", f.run, "--timeout", "0.02", "--interval", "0.01").status, 3);
  for (const args of [["--timeout", "-1"], ["--interval", "0"], ["--pid", "bad"]]) {
    assert.equal(f.invoke("wait", f.run, ...args).status, 1);
  }
});

test("resume forks the session into a new run with the recorded cwd and tools", (t) => {
  const f = fixture(t);
  installFakePi(f.bin);
  const sessionFile = makeSessionStore(f.root, f.run);
  writeFileSync(join(f.run, "spawn.json"), `${JSON.stringify({ cwd: f.root, tools: "read" })}\n`);

  const resumed = f.invoke("resume", f.run, "please continue");
  assert.equal(resumed.status, 0, resumed.stderr);
  const newRun = resumed.stdout.trim();
  assert.notEqual(newRun, f.run);
  assert.equal(dirname(newRun), dirname(f.run));
  assert.deepEqual(JSON.parse(readFileSync(join(newRun, "spawn.json"), "utf8")), { cwd: f.root, tools: "read" });

  const waited = f.invoke("wait", newRun, "--interval", "0.01", "--timeout", "2");
  assert.equal(waited.status, 0, waited.stderr);
  assert.equal(waited.stdout, "worker result\n");

  const calls = readFileSync(f.env.FAKE_PI_LOG, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    args: ["--mode", "json", "-p", "--session-id", basename(newRun), "--fork", sessionFile,
      "--tools", "read", "please continue"],
    cwd: f.root, child: "1",
  });
});

test("resume defaults the message and falls back to the session record and default tools", (t) => {
  const f = fixture(t);
  installFakePi(f.bin);
  const sessionFile = makeSessionStore(f.root, f.run);
  f.events({ type: "session", id: "old", cwd: f.root }, { type: "agent_start" });
  assert.ok(!existsSync(join(f.run, "spawn.json")));

  const resumed = f.invoke("resume", f.run);
  assert.equal(resumed.status, 0, resumed.stderr);
  const newRun = resumed.stdout.trim();
  const waited = f.invoke("wait", newRun, "--interval", "0.01", "--timeout", "2");
  assert.equal(waited.status, 0, waited.stderr);
  const calls = readFileSync(f.env.FAKE_PI_LOG, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    args: ["--mode", "json", "-p", "--session-id", basename(newRun), "--fork", sessionFile,
      "--tools", "read,grep,find,ls", DEFAULT_RESUME_MESSAGE],
    cwd: f.root, child: "1",
  });
});

test("resume --tools overrides the recorded allowlist", (t) => {
  const f = fixture(t);
  installFakePi(f.bin);
  makeSessionStore(f.root, f.run);
  writeFileSync(join(f.run, "spawn.json"), `${JSON.stringify({ cwd: f.root, tools: "read" })}\n`);

  const resumed = f.invoke("resume", f.run, "--tools", "bash", "go");
  assert.equal(resumed.status, 0, resumed.stderr);
  const newRun = resumed.stdout.trim();
  assert.deepEqual(JSON.parse(readFileSync(join(newRun, "spawn.json"), "utf8")), { cwd: f.root, tools: "bash" });
  const waited = f.invoke("wait", newRun, "--interval", "0.01", "--timeout", "2");
  assert.equal(waited.status, 0, waited.stderr);
  const calls = readFileSync(f.env.FAKE_PI_LOG, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.ok(calls[0].args.includes("--tools"));
  assert.ok(calls[0].args.includes("bash"));
});

test("resume refuses while the run's process is alive", (t) => {
  const f = fixture(t);
  makeSessionStore(f.root, f.run);
  writeFileSync(join(f.run, "pid"), `${process.pid}\n`);
  const result = f.invoke("resume", f.run);
  assert.equal(result.status, 4);
  assert.match(result.stderr, /still alive/);
  assert.equal(result.stdout, "");
});

test("resume fails when the persisted session is gone", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.run, "spawn.json"), `${JSON.stringify({ cwd: f.root, tools: "read" })}\n`);
  const result = f.invoke("resume", f.run);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /session .* not found/);
});
