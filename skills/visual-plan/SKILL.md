---
name: visual-plan
description: Create implementation plans as collapsible Markdown file trees with concise pseudocode diffs.
disable-model-invocation: true
---

# Visual plan

Produce an implementation proposal as a Markdown file tree. Keep repository source and the issue tracker read-only; the artifact is the only file you write.

## Workflow

1. **Ground.** Read the input, repository instructions, affected definitions, producers, consumers, and behavioral tests. Include issue comments when fetching a ticket. Record the revision and relevant working-tree differences.
   **Done:** every earlier-state fragment is source-backed; conflicting requirements and missing evidence are explicit.

2. **Locate.** Map each acceptance criterion, preservation constraint, proposed interface, and behavioral verification to its physical owner file. Choose the smallest change to existing responsibilities.
   **Done:** every requirement has an owner and verification; every proposed edit has a concrete reason.

3. **Plan.** Read the [worked example](examples/change-set.example.md) and follow its markup. Nest files under their directories, add a headline beside each filename, and put concise pseudocode diffs in collapsible bodies. Include useful unchanged anchors, proposed behavioral tests, and documentation edits in their own files.
   **Done:** locality is visible from indentation; filenames and headlines provide an overview; expanding a file reveals enough code-level detail to implement its changes.

4. **Audit.** Resolve paths, reconstruct the directory hierarchy, and check requirement coverage. Check every headline's word count, HTML nesting, and fenced-code boundaries. When tooling is available, render the Markdown and test disclosure toggles and a non-folding fallback.
   **Done:** existing paths resolve; proposed paths are marked inside their bodies; each headline sentence runs 5–7 words; filenames and headlines stay visible when bodies collapse; proposed tests are labeled as not yet passing.

## Output contract

- A title, source/baseline line, and explicit proposal label.
- At most three sentences covering the delta, preserved behavior, and decisive caveat. Identify the snippets as pseudocode, not an applicable source patch.
- One collapsible physical file tree under a `File tree` heading, serving as both overview and implementation plan. Include planned verification and documentation within that tree.
- Write to `$TMPDIR/visual-plan-<slug>.md` (the temp directory, `/tmp` when `$TMPDIR` is unset), or to the path a `— write to <path>` request names. Report the written path and offer to open it in the user's viewer.

## File-tree grammar

- **Directories.** Use nested Markdown lists, indented four spaces per directory level. Wrap directory contents in `<details open>` with a visible `<summary><code>directory/</code></summary>`. Directory containers represent physical paths, not architectural concepts.
- **File headlines.** A headline is a plain Markdown leaf: **`filename.py`** — A sentence of five to seven words. It summarizes the change, or names the preserved responsibility of an unchanged anchor. The headline sits outside the file's `<details>`, so it stays visible when the body collapses or a renderer ignores folding. Filenames use inline code, because some viewers drop Markdown link labels. A filename plus its ancestors identifies one repository-relative path, so disambiguate a repeated basename through its ancestors.
- **File folding.** Beneath each headline, put the fenced `diff` block inside a separate `<details open>`. Its summary is an unlabeled disclosure arrow: `<summary aria-label="Toggle changes for REPOSITORY_PATH"></summary>`. Keep the accessible name but no visible label such as “Diff.” Use `open` by default; omit it for an explicitly requested collapsed initial view.
- **Markdown boundaries.** Align HTML tags with their enclosing list content. Leave blank lines before and after fenced blocks and between nested list/HTML blocks, following the worked example. Use native indentation and disclosure elements, so the tree still reads in a viewer that ignores `<details>`; rendered indentation width belongs to the viewer.
- **Ownership.** Put functions, classes, added fields, fixtures, decisions, and invariants inside their owner file's diff. Mark proposed added/removed files inside their bodies; an added field is not an added file. Filenames stay plain paths, carrying no status or phase name.
- **Pseudocode.** Prefer signatures, field/type changes, assignments, calls, returns, and assertions over descriptions. Preserve real identifiers where they help readers find the implementation; abbreviate mechanics that do not matter. Include enough retained context to locate each change and separate independent edits with blank lines. Put prerequisites, unresolved decisions, and unknown facts in short comments in the owning file.
- **Diff notation.** `+` is proposed content, `-` is replaced content, and a leading space is retained context. Keep these textual prefixes so meaning survives without highlighting. Use ordinary fenced `diff` blocks; let the viewer supply syntax colors and horizontal scrolling.

Keep exhaustive accounting in the investigation. The delivered artifact is the file tree and its code-level plan, not a requirement matrix, table, separate flow diagram, or long design narrative.

## Invocation

```text
/skill:visual-plan https://github.com/owner/repo/issues/2
/skill:visual-plan path/to/spec.md
/skill:visual-plan <inline implementation request>
/skill:visual-plan <request> — write to path/to/plan.md
```
