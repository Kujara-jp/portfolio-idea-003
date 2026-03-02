# AI News Agent Teams 実装計画

## 概要
既存ポートフォリオにAI最新ニュース自動収集・翻訳・要約システムを組み込む。

---

## 実装ステップ

### Step 1: インフラ準備

1. **Supabase テーブル作成**
   - `ai_news` テーブル（ID/タイトル/要約/URL/ソース名/公開日/収集日時/カテゴリ）
   - **URL重複防止: source_urlにUNIQUE制約**
   - RLS ポリシー設定（Cron実行はサービスロール鍵でRLSバイパス）

2. **環境変数設定 (.env.local)**
   ```
   TAVILY_API_KEY=
   MINIMAX_API_KEY=
   MINIMAX_GROUP_ID=
   ANTHROPIC_API_KEY=
   SUPABASE_URL=
   SUPABASE_ANON_KEY=
   SUPABASE_SERVICE_ROLE_KEY=  # サーバーサイド書き込み用（RLSバイパス）
   CRON_SECRET=               # Cron job認証用シークレット
   ```

3. **依存関係インストール**
   - `@supabase/supabase-js`
   - `ai` (@ai-sdk/minimax, @anthropic-ai/sdk)

---

### Step 2: API Route 実装

4. **`/api/news/collect` (Agent Teams 本体)**
   - Tavily API でAIニュース検索
   - MiniMax で記事要約・重要度判定 で英語→日本語
   - Claude翻訳
   - MiniMax でまとめ文生成
   - **重複URLはスキップ（upsert処理）**
   - Supabase に保存（サービスロール鍵使用）

5. **`/api/news/list` (データ取得)**
   - Supabase からニュース一覧取得
   - カテゴリフィルター対応
   - ページネーション対応

---

### Step 3: フロントエンド実装

6. **`/ai-news/page.tsx`**
   - ニュースカード一覧表示
   - カテゴリフィルターバ튼
   - カードクリックでソースリンク遷移
   - 初回ロード時に `/api/news/list` からデータ取得

7. ** компонент作成**
   - `NewsCard` - 記事カード
   - `CategoryFilter` - カテゴリーフィルター

---

### Step 4: スケジューリング設定

8. **`vercel.json` Cron Job 設定**
   - 1日3回（7時・13時・19時 日本時間）実行
   - UTC換算: 22時・04時・10時
   - `/api/news/collect` を呼び出し
   - `CRON_SECRET` で認証

---

### Step 5: 検証・公開

9. **手動実行ボタン追加**
   - 管理者のみ実行可能（簡易的な認証）

10. **動作確認**
    - Cron ジョブ動作確認
    - データ表示確認

---

## ファイル構成

```
src/
├── app/
│   ├── api/
│   │   └── news/
│   │       ├── collect/route.ts    # Agent Teams 実行
│   │       └── list/route.ts       # データ取得
│   └── ai-news/
│       └── page.tsx                 # ニュースページ
├── lib/
│   └── supabase.ts                  # Supabase クライアント
├── agents/
│   ├── search.ts                    # 検索Agent
│   ├── reader.ts                    # 読解Agent
│   ├── translator.ts                # 翻訳Agent
│   └── editor.ts                    # 編集Agent
```

---

## 技術詳細

### Agent プロンプト構成

| Agent | 役割 | LLM |
|-------|------|-----|
| Search | AIニュース検索 | MiniMax |
| Reader | 記事を読んで重要度判定 | MiniMax |
| Translator | 英語→日本語翻訳 | Claude |
| Editor | まとめ文生成 | MiniMax |

---

## リスクと対応

| リスク | 対応 |
|--------|------|
| API コスト超過 | 1日9記事の上限厳守 |
| 検索ヒットなし | 代替クエリでリトライ |
| 翻訳品質低下 | プロンプト最適化 |
