# Plan: score.ts scoring prompt precision improvement

## Context

`scripts/score.ts` uses Claude Vision API (Batch) to auto-score website screenshots on two axes:
- Quality Score (1-5) stored in `sites.quality_score`
- Responsive Score (1-5) stored in `pages.responsive_score`

The current scoring prompt in `buildScoringPrompt()` (line 222-279) has vague rubric descriptors (e.g., "high quality", "standard quality") that lack concrete, observable criteria. This leads to inconsistent scoring across runs. The user wants to maximize prompt precision for reliable, reproducible scores.

Additionally, Codex CLI review found 3 P2 bugs introduced in the recent `is_blocked` commit that must be fixed alongside prompt improvements.

---

## Codex Review Findings (P2)

### 1. NULL `is_blocked` rows permanently skipped
- **File**: [score.ts:53-54](scripts/score.ts#L53-L54)
- **Issue**: `.eq("is_blocked", false)` excludes rows where `is_blocked` is NULL (pre-existing or newly collected pages without explicit default)
- **Fix**: Change to `.or("is_blocked.eq.false,is_blocked.is.null")` or `.neq("is_blocked", true)`

### 2. Blocked pages still processed by downstream tag.ts
- **File**: [score.ts:165-186](scripts/score.ts#L165-L186) and [tag.ts:169-171](scripts/tag.ts#L169-L171)
- **Issue**: When `is_blocked=true` is set on a page, `tag.ts` still picks it up (selects by `design_tone IS NULL` + `screenshot_pc IS NOT NULL`)
- **Fix**: Add `.eq("is_blocked", false)` or equivalent filter to `tag.ts` query (same NULL-safe pattern)

### 3. Temporary loading state treated as permanent block
- **File**: [score.ts:229-230](scripts/score.ts#L229-L230)
- **Issue**: "loading/blank page" in the block detection prompt causes false positives for slow-rendering JS sites (collect.ts only waits 1.5s after networkidle). Once `is_blocked=true`, the page is never re-scored.
- **Fix**: Separate prompt criteria into "permanent errors" (403, Captcha, browser error, 500) vs "uncertain states" (blank/loading) - either exclude loading from block criteria or add a separate `needs_rescrape` flag

---

## Prompt Precision Improvement

### Current problem
The rubric at lines 246-261 uses subjective adjectives without observable anchors:
- Quality: "high quality" / "standard quality" - no definition of what constitutes each level
- Responsive: "well adapted" / "standard" - similarly vague

### Proposed new rubric

**Quality Score** - anchor each level to specific visual/design signals:

| Score | Anchor criteria |
|-------|----------------|
| 1 | Broken layout, missing images/fonts, visually unusable, placeholder/template content |
| 2 | Functional but dated: inconsistent spacing, poor color contrast, no visual hierarchy, stock template feel |
| 3 | Competent baseline: consistent spacing/alignment, readable typography, coherent color palette, clear hierarchy |
| 4 | Polished: intentional whitespace, refined typography (size/weight/leading), micro-interactions visible, strong visual identity |
| 5 | Award-level craft: distinctive art direction, pixel-perfect details, sophisticated animation/transition cues, cohesive brand system |

**Responsive Score** - anchor to specific layout adaptation behaviors:

| Score | Anchor criteria |
|-------|----------------|
| 1 | Desktop layout forced onto mobile, horizontal scroll, text unreadable without zoom, tap targets overlapping |
| 2 | Partial reflow but major issues: images overflow, navigation unusable, content truncated or hidden |
| 3 | Content reflows correctly, readable text, functional navigation, but no mobile-specific optimization (e.g., hamburger menu, touch-friendly spacing) |
| 4 | Mobile-optimized: appropriate nav pattern, touch-friendly tap targets (>44px), images properly scaled, good use of vertical space |
| 5 | Mobile-first excellence: fluid typography, optimized content priority, swipe/gesture-friendly, no wasted space, feels native |

### Additional prompt improvements
- Add explicit instruction: "Score based ONLY on what is visually observable in the screenshot"
- Add calibration note: "Score 3 represents an average professionally-built website. Most sites should cluster around 3."
- Add instruction to compare PC vs SP screenshots side-by-side for responsive scoring
- Request `quality_reasons` and `responsive_reasons` to cite specific visual evidence (this already exists but should be reinforced)

---

## Codex Review Round 2 Findings

### 4. [P1] package.json scripts block replaced, breaking CI
- **File**: [package.json:5-8](package.json#L5-L8)
- **Issue**: The working-tree diff replaced the entire `scripts` block, removing `lint`, `build`, `dev`, `start`. CI calls `npm run lint` / `npm run build`.
- **Fix**: Restore existing Next.js scripts and add new helper commands alongside them

### 5. [P2] tag.ts gates tagging on `responsive_score > 1`
- **File**: [tag.ts:173](scripts/tag.ts#L173)
- **Issue**: `.gt("responsive_score", 1)` skips valid pages with score=1 or NULL (no SP screenshot). Tagging only uses `screenshot_pc`, so this filter is overly restrictive.
- **Fix**: Remove or relax the `responsive_score` filter — tagging should not depend on responsive score

### 6. [P2] Transient image fetch failure permanently prevents retry in tag.ts
- **File**: [tag.ts:220-223](scripts/tag.ts#L220-L223)
- **Issue**: On fetch failure, `design_tone = ["取得不可"]` is written. Since the query treats non-null `design_tone` as processed, the row is never retried.
- **Fix**: On fetch failure, leave `design_tone` as null (or use a separate error column) so the row is retried on next run

---

## Implementation Steps

### Completed (Round 1)
- [x] Fix `.eq("is_blocked", false)` → `.or(...)` in `score.ts:54`
- [x] Add `is_blocked` filter to `tag.ts` query
- [x] Revise block detection prompt (permanent errors only)
- [x] Rewrite `buildScoringPrompt()` with anchored rubrics
- [x] Type check + codex re-review round 2

### Remaining (Round 2)
- [ ] Restore Next.js scripts in `package.json`
- [ ] Remove `responsive_score > 1` gate from `tag.ts`
- [ ] Fix transient fetch failure handling in `tag.ts`
- [ ] Type check + codex re-review round 3

## Files to modify
- [scripts/score.ts](scripts/score.ts) - query fix + prompt rewrite (done)
- [scripts/tag.ts](scripts/tag.ts) - is_blocked filter + responsive_score gate + fetch error handling
- [package.json](package.json) - restore existing scripts

## Verification
- `npx tsc --noEmit` - type check passes
- Codex re-review until clean
