# Project instruction for Claude Code

Use ENGLISH for planning, content architecture, and agent coordination in this repository.

Rules:

- Output ENGLISH ONLY unless explicitly asked otherwise.
- Do not generate final Japanese UI copy unless the user explicitly asks for it.
- Focus on in-house IT / DX / operations-oriented messaging.
- Keep changes minimal and avoid unrelated refactors.
- Do not include personal name, nickname, employer name, or sensitive details.

## design-vault 関連の作業

このリポジトリには design-vault プロジェクトの収集・分析スクリプトが含まれる。

| リポジトリ | パス | 役割 |
|-----------|------|------|
| **design-vault** (Private) | `F:\dev\design-vault` | フロントエンド、DB設計、API、ドキュメント |
| **portfolio-idea-003** (Public/本リポジトリ) | `F:\Project\portfolio-idea-003` | 収集・分析スクリプト、GitHub Actions |

design-vault の DB設計やルールは `F:\dev\design-vault\AGENT.md` と `DATABASE_DESIGN.md` を参照すること。
運用スケジュール・コスト管理は `F:\dev\design-vault\PLAN.md` セクション4を参照すること。
