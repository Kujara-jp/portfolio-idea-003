# Agent Teams Workflow

This directory defines a minimal multi-agent workflow for this repository.

## Purpose

- Keep planning and content design in English.
- Convert approved messaging to Japanese before implementation.
- Implement only approved copy with controlled scope.
- Run a final QA gate for scope, placeholders, and layout quality.

## Roles

- Step 1: Claude Planner (`01_planner_prompt.txt`)
- Step 2: Claude Content (`02_content_prompt.txt`)
- Step 3: ChatGPT (convert to final Japanese UI copy draft, not committed yet)
- Step 4: Codex Implementer (`03_codex_implement_prompt.txt`)
- Step 5: Codex QA Reviewer (`04_codex_qa_prompt.txt`)

## Strict Order (Do Not Skip)

1. Run Claude Planner in English only.
2. Run Claude Content in English only to produce a message map.
3. Use ChatGPT to convert approved message map to final Japanese UI copy draft.
4. Use Codex to implement only approved Japanese copy for Sprint 1 scope: Top Page only.
5. Use Codex QA to verify scope, placeholders, and layout before merge.

## How To Use

1. Start with `01_planner_prompt.txt` and capture the plan output.
2. Feed planner output into `02_content_prompt.txt` and capture the message map.
3. Convert the approved message map to Japanese UI copy with ChatGPT (do not treat this as committed source yet).
4. Provide approved Japanese copy and implementation constraints to Codex via `03_codex_implement_prompt.txt`.
5. Run `04_codex_qa_prompt.txt` to confirm quality and release readiness.

## Global Constraints

- Keep prompts and intermediate plans generic.
- Do not include personal names, nicknames, employer names, or credentials.
- Keep diffs minimal and aligned to the requested scope only.
