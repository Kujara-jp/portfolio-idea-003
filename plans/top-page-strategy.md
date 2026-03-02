# Top Page Strategy: Repositioning for In-House IT / 社内SE Applications

## 1. Objective

Reposition the top page to communicate value to recruiters seeking in-house IT / 社内SE / DX candidates in Japan. The page must clearly convey: "I solve operational problems and build sustainable systems" rather than generic web development capability.

---

## 2. Target Audience

- **Primary**: In-house IT / 社内SE recruiters and hiring managers at Japanese companies
- **Secondary**: DX promotion teams, IT department managers
- **What they scan for**: Problem-solving orientation, operational improvement experience, sustainable system building mindset

---

## 3. Top Page Section Structure (Ordered)

| Order | Section | Current State | Target State |
|-------|---------|---------------|--------------|
| 1 | Hero / Introduction | Generic developer intro | Problem-solver intro with role clarity |
| 2 | Skills / Stack | Tech-focused | Business-outcome focused |
| 3 | Demo Links | Generic project links | Contextualized operational demos |
| 4 | Featured Projects | Project cards | Results-oriented project cards |

---

## 4. Message Priorities by Section

### Section 1: Hero (Introduction)

**Current**:
- Label: ポートフォリオ
- H1: `<NAME>` (placeholder)
- Subheading: Next.js developer

**Target Priority**:
- Role clarity: 社内SE・業務改善 (In-house IT / Business Improvement)
- Value statement: 現場課題整理・ツール化で改善 (Organize field issues → tool-based improvement)
- Bullet points: Replace tech stack bullets with problem→solution→outcome narrative

### Section 2: Skills / Tech Stack

**Current**: Tech-first with "MVP構築から運用改善まで"

**Target Priority**:
- Maintain tech tags (Next.js, TypeScript, etc.) as evidence
- Reposition description: "現場課題の解決と持続可能な運用" (Field problem resolution + sustainable operations)
- Add business tags: 業務改善, 屬人化解消, ナレッジ共有

### Section 3: Demo Links

**Current**:
- Helphub: "社内お問い合わせアプリ"
- GAS Tool: "抵抗値計算ツール"

**Target Priority**:
- Helphub: Frame as 属人化課題→ナレッジ共有 transformation
- GAS Tool: Frame as 製造現場での効率化 (manufacturing site efficiency)
- Remove generic descriptions; emphasize business impact

### Section 4: Featured Projects

**Current**: Standard project cards with tags

**Target Priority** (Sprint 1 - display only):
- Project cards render correctly with existing data
- Section title remains clear

**Note**: Problem → Solution → Result structure for project summaries requires updates to `content/projects/*.mdx`, which is Sprint 2 scope.

---

## 5. Content Requirements and Evidence Ideas

### Text Content Requirements

| Element | Requirement | Example |
|---------|-------------|---------|
| Hero label | Role-focused, not generic | "社内SE・業務改善" |
| Hero H1 | Value proposition, not name | "現場課題整理・ツール化で改善" |
| Hero subheading | Problem-solver narrative | "現場課題を整理し、自動化・ツール化で改善" |
| Hero bullets | Outcome-oriented | "属人化していた質問対応を改善" instead of "TypeScript熟练" |
| Skills description | Operations-focused | "現場課題の解決と持続可能な運用" |
| Demo descriptions | Business context | "製造現場での効率化" not "抵抗値計算" |
| Project summaries | Problem→Solution→Result | Three-line structure |

### Evidence Ideas

- **Before/after metrics**: Quantify improvements where possible
- **Use case framing**: Who had the problem, what was the impact
- **Operational context**: Emphasize sustainability and team adoption
- **Tool evidence**: Working demos that prove capability

### Placeholders to Remove

**Sprint 1 scope (src/app/page.tsx only):**
- `<NAME>` → Role-based title

**Future sprints (out of scope):**
- `<EMAIL>` → Contact section (Sprint 3)
- `<COMPANY>` → Generic company reference (Sprint 3)
- `<GITHUB_URL>` → Remove or make generic (Sprint 3)

---

## 6. Implementation Notes for Codex

### Files to Modify

| File | Scope | Priority |
|------|-------|----------|
| `src/app/page.tsx` | Hero, Skills, Demo, Projects sections | Sprint 1 |
| `content/projects/*.mdx` | Project summaries | Sprint 2 (out of scope) |

### Implementation Constraints

- **Maintain layout**: Do not change UI structure, only text content
- **Maintain demo URLs**: Keep existing helphub-pink.vercel.app links
- **Keep tech stack**: Next.js, TypeScript, Tailwind tags remain as evidence
- **No new components**: Reuse existing card/link patterns
- **No personal identifiers**: Remove all placeholders, use generic role descriptions

### Code Changes Expected

1. **Hero section** (lines 20-45): Update label, H1, subheading, bullet text
2. **Skills section** (lines 47-74): Update description text only
3. **Demo links** (lines 76-98): Update link descriptions
4. **Featured projects** (lines 100-137): Update section title only (project summaries updated in Sprint 2)

---

## 7. Risks and Assumptions

### Risks

| Risk | Mitigation |
|------|------------|
| Content too generic | Use specific business contexts (manufacturing, support desk) |
| Recruiters miss the pivot | Clear hero messaging with 社内SE・業務改善 label |
| Placeholder remnants | Systematic grep for `<[A-Z_]+>` in src/app/page.tsx before PR (do NOT check about/page.tsx or content/projects/*.mdx in Sprint 1) |
| Demo links go stale | External Vercel/GAS demos may become unavailable. Mitigation: Include screenshot fallbacks in project detail pages; working demos provide stronger evidence but are not required for initial screening |

### Assumptions

- Target companies value operational improvement over pure coding skill
- Demo apps (Helphub, GAS tool) sufficiently demonstrate problem-solving ability
- No legal/compliance issues with showing internal tool concepts
- Recruiters will view on desktop; no responsive concerns for this sprint

---

## 8. Handoff Package for Claude Content

### Input Materials

1. **Existing plan**: `plans/parallel-crafting-hummingbird.md` (reference only, contains Japanese)
2. **Current page**: `src/app/page.tsx`
3. **Projects data**: `content/projects/helphub.mdx` (future sprint)
4. **About page**: `src/app/about/page.tsx` (future sprint)

### Deliverable for Claude Content

The Claude Content agent should receive:

1. This strategy document
2. Access to the current `src/app/page.tsx` for reference
3. Instruction to:
   - Rewrite hero section text (label, H1, subheading, bullets) with role-focused, outcome-oriented language
   - Update skills description to emphasize field problem resolution
   - Reposition demo link descriptions with business context
   - Remove all placeholders from src/app/page.tsx (`<NAME>`, etc.)
   - Keep all UI/layout unchanged

### Success Criteria

- [ ] Hero clearly reads as "in-house IT / business improvement" not "web developer"
- [ ] No personal placeholders remain in src/app/page.tsx (about/page.tsx and project MDX files are out of scope for Sprint 1)
- [ ] Demo links include business context
- [ ] Skills section emphasizes operational outcomes
- [ ] Strategy document in English (UI labels/content handled separately per CLAUDE.md rules - Japanese OK for recruiter-facing copy)
- [ ] Build passes: `npm run build`
- [ ] Lint passes: `npm run lint`

---

## Summary

This strategy pivots the top page from "developer portfolio" to "operations problem solver." The key shift is messaging from "I build with X technology" to "I solve Y problems for Z teams." All implementation focuses on text content changes; UI structure remains untouched.
