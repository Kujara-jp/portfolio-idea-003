# Sprint 2 Kickoff Plan

## Context
- Sprint 1: Top page repositioned for in-house IT / 社内SE / DX (COMPLETE)
- Current state: page.tsx has proper Japanese copy; project MDX files have outdated placeholder content

---

## Option A: Fix Project Detail Pages

### Objective
Update project detail pages to match the in-house IT positioning. Each project's MDX should tell a problem → solution → result story relevant to operational improvement.

### File Scope
- `content/projects/helphub.mdx`
- `content/projects/tooling.mdx`
- (Check if sample-site.mdx should be removed or updated)

### Acceptance Criteria
- [ ] Each project has clear 課題/アプローチ/結果 structure
- [ ] Business context: what operational problem was solved
- [ ] No `<GITHUB_URL>` or `<DEMO_URL>` placeholders remain
- [ ] Content aligns with in-house IT / 社内SE tone
- [ ] Build passes: `npm run build`
- [ ] Lint passes: `npm run lint`

### Risks
- Need accurate details about each demo tool's actual functionality
- May need to verify demo URLs still work

### Handoff Notes for Codex
1. Review `plans/top-page-strategy.md` for tone guidelines
2. For each project MDX:
   - Rewrite 課題 (problem) section with actual operational context
   - Rewrite アプローチ (approach) section with solution narrative
   - Rewrite 結果 (result) section with outcome/metrics if available
3. Remove all placeholder URLs or use generic text
4. Do NOT change frontmatter tags or layout

---

## Option B: Add About Page Content

### Objective
Create or update the about page to provide professional background context for recruiters. This page serves as the "resume" complement to the portfolio.

### File Scope
- `src/app/about/page.tsx`
- Possibly `content/about/*.mdx` if using content layer

### Acceptance Criteria
- [ ] Professional background (years of experience, role focus)
- [ ] Skills alignment with in-house IT / DX positioning
- [ ] No personal details: no name, no company names, no credentials
- [ ] Tone: understated, professional, business Japanese
- [ ] Build passes: `npm run build`
- [ ] Lint passes: `npm run lint`

### Risks
- Must maintain privacy (no personal identifiers)
- Need to balance completeness with minimalism

### Handoff Notes for Codex
1. Check existing about/page.tsx structure
2. Add sections:
   - 経歴概要 (career summary - role-focused, not company names)
   - 得意領域 (areas of expertise aligned with 社内SE)
   -  업무 접근 (approach to work)
3. Use generic role descriptions: "Web 系企業での経験" not specific company
4. Keep layout minimal; reuse existing card patterns

---

## Recommendation

**Option A (Fix Project Detail Pages)** is the smaller, more contained task:
- Directly addresses the Sprint 1 handoff notes (project summaries were Sprint 2 scope)
- 3 files to update
- Clear acceptance criteria
- No privacy concerns

**Option B** is valuable but requires more careful content drafting and has higher risk of scope creep.

---

## Next Step
Select an option and proceed with implementation. Each should take 1-2 hours.
