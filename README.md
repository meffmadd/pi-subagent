# pi-subagent

A skill for [pi](https://github.com/earendil-works/pi-coding-agent) that spawns **subagents**: background child `pi` processes with a fresh context. They share your cwd and credentials, see none of your conversation, and your context grows only by what you read back.

Use it when the legwork outweighs the answer — many files to read, big logs to sift, parallel investigations to pull. Managed by the bundled `pi-subagent` CLI (`spawn`, `state`, `steps`, `text`, `result`, `wait`).

## Requirements

- `pi` CLI on PATH
- Node.js ≥ 23.6 (to run the bundled TypeScript script directly)

## Install

With the [skills CLI](https://skills.sh) (works for pi and 100+ other agents):

```bash
npx skills add meffmadd/pi-subagent
```

Or pi-native:

```bash
pi install git:github.com/meffmadd/pi-subagent
```

## Usage

Ask your agent to use the skill, or load it directly with `/skill:pi-subagent`. Quick taste:

```bash
CLI=skills/pi-subagent/scripts/pi-subagent.ts

RUN=$(node "$CLI" spawn --tools read,grep,find,ls --thinking low \
  "Find every TODO in this repo. <worker contract>")

node "$CLI" wait "$RUN"   # blocks until settled, prints the final summary
```

The agent-facing contract — spawn, inspect, follow-ups, guardrails — lives in [`skills/pi-subagent/SKILL.md`](skills/pi-subagent/SKILL.md). Run `node "$CLI" --help` for the full CLI reference.

## Development

```bash
git clone https://github.com/meffmadd/pi-subagent
cd pi-subagent
npm test                                               # run tests
npx skills add . -a pi -g                             # install your working copy globally
```

Edits in the repo do not propagate to installed copies; refresh a local-path install by re-running `npx skills add . -a pi -g` (`npx skills update` cannot refresh local sources).
