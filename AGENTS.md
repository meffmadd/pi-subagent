# AGENTS.md

A pi skill: `skills/pi-subagent/` bundles `SKILL.md` and a CLI (`scripts/pi-subagent.ts`) that spawns background `pi` subagents. Human-facing install and usage docs live in `README.md`.

## What ships

`npx skills add` and `pi install` copy `skills/pi-subagent/` verbatim into users' skill directories. Keep that directory to what an installing agent needs — `SKILL.md` and the script. Tests and dev tooling live outside it, in `test/`.

`SKILL.md` resolves `scripts/pi-subagent.ts` relative to itself; keep that path stable.

## Dev loop

- `npm test` runs the suite; the TypeScript runs directly under Node ≥ 23.6. When calling `node --test` yourself, pass a glob (`node --test 'test/*.test.ts'`) — a bare directory argument fails on Node 26.
- Installed copies are snapshots. After edits, refresh your global install from the repo root with `npx skills add . -a pi -g`; `npx skills update` skips local-path sources.
