# Top Page Message Map (English Source)

## Purpose
This document provides English source text for UI copy conversion to Japanese. Sprint 1 scope: `src/app/page.tsx` only.

---

## 1) Message Map Table by Section

### Section 1: Hero / Introduction

| Field | Value |
|-------|-------|
| **Section ID** | hero |
| **Intent** | Communicate role as in-house IT / business improvement specialist, not generic web developer |
| **Primary Message (EN)** | "I organize field issues and improve processes through automation and tool development" |
| **Supporting Points (EN)** | 1) "Reduced manual work by identifying and addressing recurring operational issues" <br> 2) "Built sustainable tools that teams can maintain without specialized knowledge" <br> 3) "Focus on practical solutions that solve real business problems" |
| **CTA Intent** | Navigate to projects page or learn about the approach |
| **Placeholder/Proof Requirements** | Replace `<NAME>` with role-focused title (no personal name) |

---

### Section 2: Skills / Tech Stack

| Field | Value |
|-------|-------|
| **Section ID** | skills |
| **Intent** | Demonstrate technical capability as evidence of problem-solving ability |
| **Primary Message (EN)** | "Solving field problems and building sustainable operations with technology" |
| **Supporting Points (EN)** | Technical skills serve as proof points: Next.js, TypeScript, React for building practical tools |
| **CTA Intent** | None (informational) |
| **Placeholder/Proof Requirements** | Keep existing tech tags as evidence; update description to operations-focus |

---

### Section 3: Demo Links

| Field | Value |
|-------|-------|
| **Section ID** | demos |
| **Intent** | Provide concrete evidence of problem-solving approach |
| **Primary Message (EN)** | "Tools built to address real operational challenges" |

**Demo Item 1: Helphub**

| Field | Value |
|-------|-------|
| **Title (EN)** | "Internal Inquiry & Knowledge Management System" |
| **Description (EN)** | "Transformed repetitive support inquiries into searchable knowledge base, reducing duplicated responses" |

**Demo Item 2: GAS Tool**

| Field | Value |
|-------|-------|
| **Title (EN)** | "Manufacturing Efficiency Tool" |
| **Description (EN)** | "Automated calculation workflow for manufacturing site, reducing manual errors and processing time" |

| **CTA Intent** | View working demo |
| **Placeholder/Proof Requirements** | Keep existing URLs (helphub-pink.vercel.app, GAS script) |

---

### Section 4: Featured Projects

| Field | Value |
|-------|-------|
| **Section ID** | projects |
| **Intent** | Display selected projects (Sprint 1: display only, no content changes) |
| **Primary Message (EN)** | "Featured Work" or "Selected Projects" |
| **Supporting Points (EN)** | Project cards render from existing data |
| **CTA Intent** | View all projects or project details |
| **Placeholder/Proof Requirements** | Update section title only; project summaries remain unchanged (Sprint 2 scope) |

---

## 2) Tone and Style Guardrails for Japanese Conversion

### Do

- Use business Japanese appropriate for corporate recruiters (企業採用担当向けビジネス日本語)
- Emphasize practical value and operational improvement (実用的価値・業務改善)
- Use professional, understated tone (專業的・控えめなトーン)
- Frame achievements as problem → solution → outcome
- Keep text concise and scannable

### Don't

- Avoid freelance or sales tone (フリーランス・営業 toneを避ける)
- Avoid startup or product marketing tone (スタートアップ・プロダクトマーケティング toneを避ける)
- Avoid personal pronouns or self-promotional language (私・我々などの第一人称を避ける)
- Avoid overly technical jargon without business context
- Avoid casual or colloquial expressions

### Style Guidelines

- **Role focus**: Use role-based identity, not personal name
- **Problem-solver framing**: "課題を解決する" rather than "開発した"
- **Outcome orientation**: Mention impact/改善/効率化 where possible
- **Professional modesty**: Use "対応しました" / "構築しました" rather than "成功させた"

---

## 3) Open Questions to Resolve Before Implementation

| # | Question | Impact |
|---|----------|--------|
| 1 | Should section labels (Hero label, section titles) be in Japanese or English? | UI text decisions |
| 2 | What specific business context should the hero bullets emphasize? (e.g., support desk, manufacturing, internal tools) | Content specificity |
| 3 | Is "注目" for Featured Projects section appropriate, or should it be "注目の作品" or "選定作品"? | Word choice |
| 4 | Should CTA buttons maintain current Japanese ("作品一覧を見る") or use role-focused alternatives? | CTA text |

---

## 4) Handoff Package for ChatGPT Conversion (Step 3)

### Input for Step 3

1. **This message map** (English source)
2. **Current page reference**: `src/app/page.tsx` (lines to modify)
3. **Strategy document**: `plans/top-page-strategy.md` (context)

### Instructions for ChatGPT

Convert the English source text in the message map to natural Japanese UI copy, following these rules:

1. **Preserve intent**: Each Japanese string must convey the same message as the English source
2. **Match tone**: Business Japanese for corporate recruiters, not casual or sales tone
3. **Fit existing layout**: Text length should fit current UI constraints (use current text as length reference)
4. **Maintain placeholders**: Keep demo URLs unchanged
5. **Keep tech tags**: Next.js, TypeScript, React, etc. remain in English

### Specific Conversion Requirements

| Source Element | Target Japanese (generate) |
|----------------|---------------------------|
| Hero label | 社内SE・業務改善 |
| Hero H1 | 現場課題整理・ツール化で改善 |
| Hero subheading | 現場課題を整理し、自動化・ツール化で改善 |
| Hero bullet 1 | 属人化していた質問対応を改善 |
| Hero bullet 2 | チームが持続可能な形で運用できるツールを構築 |
| Hero bullet 3 | 実務課題に直結した解决方案を提供 |
| Skills section title | できること / 技術スタック |
| Skills description | 現場課題の解決と持続可能な運用 |
| Demo section title | デモ / リンク |
| Helphub title | 社内お問い合わせ・ナレッジ管理 |
| Helphub description | 重复するご質問を検索可能なナレッジベースに変換し、回答的重複を削減 |
| GAS tool title | 製造現場効率化ツール |
| GAS tool description | 製造現場の計算ワークフローを自動化し、手動エラーと処理時間を削減 |
| Projects section label | 注目 |
| Projects section title | ピックアップ作品 |
| CTA "作品一覧を見る" | (keep or adjust) |
| CTA "このMVPについて" | (keep or adjust) |

### Success Criteria for Step 3

- [ ] All English source text converted to Japanese
- [ ] Tone is professional, business-appropriate for corporate recruiters
- [ ] No personal names, company names, or credentials included
- [ ] Demo URLs remain unchanged
- [ ] Tech tags remain in English
- [ ] Text fits existing UI layout constraints
- [ ] Build passes: `npm run build`
- [ ] Lint passes: `npm run lint`

---

## Summary

This message map provides English source text for converting the top page to in-house IT / 社内SE positioning. The key shift is from "web developer" to "operations problem solver" messaging, with emphasis on practical business value and sustainable system building.

Sprint 1 scope: Hero, Skills, Demo descriptions in `src/app/page.tsx`. Featured Projects section title update only; project content changes are Sprint 2.
