# AGENTS.md

An agent skill collection. Human-facing install and usage docs live in `README.md`.

## What ships

Distributable skills live in `skills/<name>/`, each with a `SKILL.md`. Keep each directory to what an installing agent needs; tests and dev tooling live outside it, in `test/`.

`skills/pi-subagent/SKILL.md` resolves `scripts/pi-subagent.ts` relative to itself; keep that path stable. `skills/simplification-review/` is instructions-only. `skills/visual-plan/` ships its validated example next to `SKILL.md`; the skill points at it.

## Dev loop

- `npm test` runs the suite; the TypeScript runs directly under Node ≥ 23.6. When calling `node --test` yourself, pass a glob (`node --test 'test/*.test.ts'`) — a bare directory argument fails on Node 26.
- Installed copies are snapshots. After edits, refresh your global install from the repo root with `npx skills add . -a pi -g`; `npx skills update` skips local-path sources.
