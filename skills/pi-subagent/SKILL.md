---
name: pi-subagent
description: >-
  Spawn Pi subagents — background child `pi` processes with a fresh context — via the bundled pi-subagent.ts CLI: delegate context-heavy investigation, run parallel background workers, or inspect and wait for a running subagent. Use when reading would flood your context, when several independent investigations should run at once, or when checking a background worker's progress or result.
compatibility: pi CLI on PATH; Node.js ≥ 23.6 to run the bundled TypeScript script directly.
---

# Pi subagents

A **subagent** is a child `pi` process with a fresh context: it shares your cwd and credentials, sees none of your conversation, and your context grows only by what you read back. Spawn one when the legwork outweighs the answer — many files to read, big logs to sift, parallel investigations to pull. For one or two lookups, read them yourself.

## Worker contract

The subagent's final message is the only thing you read back, so state the contract in the task itself:

> Your final message is the only thing the caller reads. End with a self-contained summary under 40 lines: what you found or did, absolute paths of files read or changed, and anything the caller must do next.

## Usage

Resolve `scripts/pi-subagent.ts` relative to this `SKILL.md` and set `CLI` to its absolute path. Invoke it with `node "$CLI"`; keep the caller's working directory so workers run in the same project. `node "$CLI" --help` prints the full reference, and the script source documents its internals. A foreground one-shot needs none of it:

```bash
pi -p --tools read,grep,find,ls "TASK. <worker contract>"
```

### Spawn a background subagent

```bash
RUN=$(node "$CLI" spawn --tools read,grep,find,ls --thinking low "TASK. <worker contract>")
```

`spawn` prints the run dir `/tmp/pi-subagents/<session-id>` once the worker process starts, without waiting for its task to finish. It contains `events.jsonl`, `pid`, `stderr.log`, and `spawn.json` (project cwd and tools, for `resume`). The worker's session persists in the project's session store; the run dir is throwaway. For long tasks, pass `"@/path/to/task.md"` instead of task text. For pi flags `spawn` does not expose, run `pi --mode json -p <flags> "TASK"` directly.

Parallel workers: one spawn each — each gets its own session — then wait on each in turn.

### Inspect and collect

Pass the run directory printed by `spawn` or `resume` to every inspection command.

| Command | Prints | Exit |
|---|---|---|
| `state "$RUN"` | one-line JSON: status, turns, toolCalls, tokens, cost, model | 0 |
| `steps "$RUN"` | tool calls so far, with durations and ok/ERR | 0 |
| `text "$RUN"` | latest completed assistant text | 0 |
| `result "$RUN"` | final text | 0 settled · 4 otherwise |
| `wait "$RUN"` | blocks until settled or the process exits, then final text | 0 · 3 timeout · 4 failed |

`wait` reads `$RUN/pid` automatically; `--timeout S` (default 600) and `--interval S` tune it. A worker that dies unsettled surfaces its stderr in `wait`'s error.

### Follow-ups and resumes

Continue the worker's session instead of respawning. For a quick interactive follow-up, run it in the foreground:

```bash
pi -p --session "$(basename "$RUN")" "Follow-up question. <worker contract>"
```

For a dead worker, or a follow-up that should run untended, `resume` forks the session into a fresh background run and prints its run dir:

```bash
RUN2=$(node "$CLI" resume "$RUN" "Verify the fix, then report.")
node "$CLI" wait "$RUN2"
```

`resume` keeps the session's context, model, and reasoning level; `--tools`, `--model`, and `--thinking` override them. Without a message, the worker is told to resume where it stopped. It refuses while the run's process is alive and fails if the persisted session is gone.

## Guardrails

- Each subagent is a full agent run: real tokens and cost. Spend it where the legwork is real.
- `spawn` marks the child with `$PI_SUBAGENT_CHILD`; when it is set in your environment, you are already a subagent: do the work yourself and end with the summary the contract asked for.
- Stop a runaway with `kill "$(cat "$RUN/pid")"`.
- A connection error is not a dead worker: pi auto-retries transient errors (3 attempts). `wait` for the process to exit before resuming; `resume` refuses while it is alive.
