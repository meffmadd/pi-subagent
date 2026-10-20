# skills

My personal skills repository.

| Skill | Purpose |
| --- | --- |
| [pi-subagent](skills/pi-subagent/SKILL.md) | Spawn and manage background `pi` subagents with fresh contexts. |
| [simplification-review](skills/simplification-review/SKILL.md) | Rank evidence-backed opportunities to remove superfluous abstractions, mechanisms, and optional features. |

## Install

With the [skills CLI](https://skills.sh) (works for pi and 100+ other agents):

```bash
npx skills add meffmadd/skills
```

Or pi-native:

```bash
pi install git:github.com/meffmadd/skills
```

## Usage

### pi-subagent

Spawns **subagents**: background child `pi` processes with a fresh context. They share your cwd and credentials, see none of your conversation, and your context grows only by what you read back. Use it for context-heavy legwork or parallel investigations.

Requires the `pi` CLI on PATH and Node.js ≥ 23.6 to run the bundled TypeScript script directly.

Ask your agent to use the skill, or load it directly in pi with `/skill:pi-subagent`. Quick taste:

```bash
CLI=skills/pi-subagent/scripts/pi-subagent.ts

RUN=$(node "$CLI" spawn --tools read,grep,find,ls --thinking low \
  "Find every TODO in this repo. <worker contract>")

node "$CLI" wait "$RUN"   # blocks until settled, prints the final summary

RUN2=$(node "$CLI" resume "$RUN" "Now write the tests.")  # fork the session into a new background run
node "$CLI" wait "$RUN2"
```

The agent-facing contract — spawn, inspect, follow-ups, guardrails — lives in [`skills/pi-subagent/SKILL.md`](skills/pi-subagent/SKILL.md). Run `node "$CLI" --help` for the full CLI reference.

### simplification-review

Ask your agent to use the skill, or invoke it directly in pi:

```text
/skill:simplification-review Review this repo for overengineering.
```

The skill traces workflows, applies a deletion test, and ranks supported simplification options by superfluousness. It distinguishes refactors from interface changes, feature cuts, and guarantee reductions. It reviews only unless you request implementation.

## Development

```bash
git clone https://github.com/meffmadd/skills
cd skills
npm test                       # run tests
npx skills add . -a pi -g       # install your working copy globally
```

Edits in the repo do not propagate to installed copies; refresh a local-path install by re-running `npx skills add . -a pi -g` (`npx skills update` cannot refresh local sources).
