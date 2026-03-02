# Sprint 2: Project Detail Pages Message Architecture

## Overview
This document provides English source message architecture for updating 3 project detail pages in Sprint 2.

**Objective**: Reposition project detail pages to demonstrate operational problem-solving capability for in-house IT / 社内SE / DX hiring.

**Target Audience**: Japanese corporate recruiters seeking operational improvement candidates.

---

## Project 1: Helphub (社内お問い合わせ管理)

### 1) Page Objective
Demonstrate ability to transform repetitive internal support operations into sustainable, searchable knowledge systems.

### 2) Target Recruiter Takeaway
" 이 사람은現場の声聞いて、属人化問題を仕組みで解決できる" (This candidate addresses operational bottlenecks with systematic solutions)

### 3) Recommended Content Structure
| Order | Section | Purpose |
|-------|---------|---------|
| 1 | 課題 (Problem) | What operational bottleneck existed |
| 2 | アプローチ (Approach) | How the problem was analyzed and addressed |
| 3 | 結果 (Result) | Measurable or observable improvement |
| 4 | 技術 (Tech) | Tools used (secondary evidence) |

### 4) Key Message Points

**課題 Section**
- Focus: Internal support operations before the tool
- Message: Repetitive inquiries consumed staff time; answers existed but weren't searchable
- Tone: Problem-oriented, not solution-first

**アプローチ Section**
- Focus: How the solution was built with operations in mind
- Message: Ticket-based workflow with access control; prioritized ease of maintenance over complexity
- Tone: Practical, operations-focused

**結果 Section**
- Focus: Operational impact
- Message: Reduced duplicate responses; faster lookup for common issues
- Tone: Outcome-oriented, understated

**技術 Section**
- Keep: Next.js, TypeScript (as evidence)
- Remove: Generic "gray-matter" mentions if not relevant

### 5) What to Remove / Rewrite
- REMOVE: Current 課題 about "portfolio updates" (wrong context)
- REWRITE: All sections with operational support desk scenario
- REMOVE: `<GITHUB_URL>`, `<DEMO_URL>` placeholders

### 6) Risks / Missing Evidence
- Need actual demo URL (currently placeholder)
- Need to verify if Helphub demo still works
- May not have exact metrics; acceptable to describe qualitative improvements

### 7) Handoff Notes for Japanese Copy
- Use business Japanese: "対応しました" not "作りました"
- Emphasize: 属人化削減, 検索性向上, 運用負荷軽減
- Avoid: Technical jargon without business context
- Keep tech tags in English: Next.js, TypeScript

---

## Project 2: Tooling (業務手順のナレッジ整備)

### 1) Page Objective
Demonstrate ability to reduce operational knowledge silos through documentation and tooling.

### 2) Target Recruiter Takeaway
"この人は屬人化を減らしてチームでknow-howを共有できる" (This candidate reduces knowledge silos and enables team-wide knowledge sharing)

### 3) Recommended Content Structure
| Order | Section | Purpose |
|-------|---------|---------|
| 1 | 課題 (Problem) | Knowledge fragmentation issue |
| 2 | アプローチ (Approach) | Solution design with maintainability focus |
| 3 | 結果 (Result) | Improved accessibility and reduce rework |
| 4 | 技術 (Tech) | Implementation details |

### 4) Key Message Points

**課題 Section**
- Focus: Operational knowledge was trapped in individual heads or scattered files
- Message: Difficulty finding updated procedures; knowledge loss when key persons unavailable

**アプローチ Section**
- Focus: File-based approach with low barrier to updates
- Message: Chose MDX for flexibility; prioritized editability over complex features

**結果 Section**
- Focus: Faster updates, reduced knowledge loss risk
- Message: Closer proximity between source and published content

**技術 Section**
- Keep: Next.js, MDX, App Router
- Simplify: Remove unnecessary technical details

### 5) What to Remove / Rewrite
- REWRITE: Current content is about "repo management" - reposition to "knowledge accessibility"
- REMOVE: Technical-first framing (should be operations-first)
- REMOVE: `<GITHUB_URL>`, `<DEMO_URL>` placeholders

### 6) Risks / Missing Evidence
- Abstract project; harder to quantify impact
- Acceptable: Focus on approach and thinking process

### 7) Handoff Notes for Japanese Copy
- Use: 属人化解消, ナレッジ共有, 運用負荷
- Avoid: Developer-centric framing ("convenient for devs")
- Tone: Business operations improvement, not tech showcase

---

## Project 3: Sample Site (既存サイト運用改善)

### 1) Page Objective
Demonstrate ability to improve existing systems without disruptive rewrites — practical, incremental improvement mindset.

### 2) Target Recruiter Takeaway
"大きな刷新ではなく、地道な改善で運用負荷を下げられる" (This candidate improves operations through steady incremental changes, not flashy rewrites)

### 3) Recommended Content Structure
| Order | Section | Purpose |
|-------|---------|---------|
| 1 | 課題 (Problem) | Legacy/maintenance burden |
| 2 | アプローチ (Approach) | Low-risk improvement strategy |
| 3 | 結果 (Result) | Reduced maintenance effort |
| 4 | 技術 (Tech) | Implementation details |

### 4) Key Message Points

**課題 Section**
- Focus: Existing site had maintenance overhead; updates were painful
- Message: Inconsistent information; high effort for small changes

**アプローチ Section**
- Focus: Minimal intervention approach
- Message: Defined content structure upfront; improved information flow without full rebuild

**結果 Section**
- Focus: Reduced update friction
- Message: Easier for non-technical staff to maintain

**技術 Section**
- Keep: TypeScript, Tailwind (as needed)
- Simplify: Focus on practical improvements

### 5) What to Remove / Rewrite
- REWRITE: Current 課題 about "case-by-case granularity" - too abstract
- FOCUS: Emphasize "maintenance burden reduction" not "consistency"
- REMOVE: `<GITHUB_URL>`, `<DEMO_URL>` placeholders

### 6) Risks / Missing Evidence
- Generic project title; needs concrete operational framing
- May need to verify demo availability

### 7) Handoff Notes for Japanese Copy
- Use: 運用負荷軽減, 更新コスト削減, 地道な改善
- Avoid: "beautiful UI" or "modern design" language
- Tone: Practical operations improvement

---

## Cross-Cutting Guidelines

### Tone by Section

| Section | Do | Don't |
|---------|-----|-------|
| 課題 | Use operational language: 負荷, 属人化, 手戻り, 検索性 | Use dev language: 学习了, 练习了 |
| アプローチ | Emphasize analysis + planning: 要件整理, 優先順位 | Rush to solution: 作りました |
| 結果 | Show impact:削減, 向上, 軽減 | Overclaim: 大成功, 革命 |
| 技術 | List as evidence, keep brief | Lead with tech |

### Common Placeholders to Remove
- `<GITHUB_URL>` → Either remove link or use generic text
- `<DEMO_URL>` → Use actual demo URL or remove

### Acceptance Criteria
- [ ] Each project tells operational problem → solution → result story
- [ ] No personal identifiers (names, companies, credentials)
- [ ] No template-style placeholder content
- [ ] Tone aligns with in-house IT / 社内SE positioning
- [ ] All placeholder URLs resolved
- [ ] Build passes: `npm run build`
- [ ] Lint passes: `npm run lint`

---

## Handoff for Codex Implementation

### Input Materials
1. This message architecture document
2. Current MDX files: `content/projects/{helphub,tooling,sample-site}.mdx`
3. Reference: `plans/top-page-strategy.md` for tone guidelines

### Instructions for Codex
1. Rewrite each project MDX following the structure above
2. Use actual demo URLs where available (check helphub-pink.vercel.app)
3. Remove all placeholder URLs or use generic text
4. Keep frontmatter tags minimal (current tags are fine)
5. Do not change slug, date, or featured status
6. Maintain YAML frontmatter format

### Success Criteria
- [ ] All 3 project pages updated
- [ ] Each tells operational improvement story
- [ ] No `<GITHUB_URL>` or `<DEMO_URL>` remain
- [ ] Build passes
- [ ] Lint passes
