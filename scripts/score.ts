/**
 * design-vault: 採点スクリプト
 * スクリーンショットを Claude Vision API に送り、以下を自動採点する
 *   ⑦ クオリティスコア（1〜5）
 *   ⑬ レスポンシブ対応品質スコア（1〜5）
 *
 * 実行方法:
 *   npx tsx scripts/score.ts
 *   npx tsx scripts/score.ts --limit=5
 */

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

// ============================================================
// 設定
// ============================================================
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const BATCH_LIMIT = limitArg ? parseInt(limitArg.split("=")[1]) : 5;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// ============================================================
// 型定義
// ============================================================
interface ScoreResult {
  quality_score: number;
  quality_reasons: string[];
  responsive_score: number | null;
  responsive_reasons: string[];
}

// ============================================================
// メイン処理
// ============================================================
async function main() {
  console.log(`[score] 開始 (最大${BATCH_LIMIT}件)`);

  // 未採点のページを取得（PC スクショあり・スコアなし）
  const { data: pages, error } = await supabase
    .from("pages")
    .select("page_id, site_id, screenshot_pc, screenshot_sp, page_type")
    .is("responsive_score", null)
    .not("screenshot_pc", "is", null)
    .limit(BATCH_LIMIT);

  if (error) {
    console.error("[score] ページ取得エラー:", error.message);
    process.exit(1);
  }

  if (!pages || pages.length === 0) {
    console.log("[score] 採点対象なし。終了します。");
    return;
  }

  console.log(`[score] ${pages.length}件を採点します`);

  for (const page of pages) {
    console.log(`\n[score] 採点中: page_id=${page.page_id}`);

    try {
      const result = await scoreWithVision(
        page.screenshot_pc,
        page.screenshot_sp,
        page.page_type,
      );

      // sites テーブルのクオリティスコアを更新
      const { error: siteError } = await supabase
        .from("sites")
        .update({ quality_score: result.quality_score })
        .eq("site_id", page.site_id);

      if (siteError) throw new Error(`sites 更新エラー: ${siteError.message}`);

      // pages テーブルのレスポンシブスコアを更新
      const { error: pageError } = await supabase
        .from("pages")
        .update({
          responsive_score: result.responsive_score,
          needs_review: false,
        })
        .eq("page_id", page.page_id);

      if (pageError) throw new Error(`pages 更新エラー: ${pageError.message}`);

      console.log(
        `[score] ✅ 完了 quality=${result.quality_score} responsive=${result.responsive_score ?? "n/a"}`,
      );
      console.log(
        `[score]   クオリティ: ${result.quality_reasons.join(" / ")}`,
      );
      if (result.responsive_reasons.length > 0) {
        console.log(
          `[score]   レスポンシブ: ${result.responsive_reasons.join(" / ")}`,
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[score] ❌ エラー: page_id=${page.page_id} - ${message}`);
    }
  }

  console.log("\n[score] 全処理完了");
}

// ============================================================
// Claude Vision API 採点
// ============================================================
async function scoreWithVision(
  screenshotPcUrl: string,
  screenshotSpUrl: string | null,
  pageType: string,
): Promise<ScoreResult> {
  const hasSpscreenshot = !!screenshotSpUrl;

  // 画像を base64 に変換
  const pcBase64 = await fetchImageAsBase64(screenshotPcUrl);
  const spBase64 = hasSpscreenshot
    ? await fetchImageAsBase64(screenshotSpUrl!)
    : null;

  // プロンプト構築
  const prompt = buildScoringPrompt(pageType, hasSpscreenshot);

  // コンテンツ配列を構築
  const content: Anthropic.MessageParam["content"] = [
    {
      type: "image",
      source: { type: "base64", media_type: "image/png", data: pcBase64 },
    },
    ...(spBase64
      ? [
          {
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: "image/png" as const,
              data: spBase64,
            },
          },
        ]
      : []),
    { type: "text", text: prompt },
  ];

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    messages: [{ role: "user", content }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as Anthropic.TextBlock).text)
    .join("");

  return parseScoreResponse(text, hasSpscreenshot);
}

// ============================================================
// プロンプト
// ============================================================
function buildScoringPrompt(pageType: string, hasSpScreen: boolean): string {
  return `あなたはWebデザインの専門家です。添付のスクリーンショットを見て、以下の採点基準に従って採点してください。

## ページ種別
${pageType}

## ⑦ クオリティスコア採点基準（1〜5）

| スコア | 基準 |
|--------|------|
| 1 | 問題が複数あり参考にならない |
| 2 | 業界水準を下回る。改善余地が多い |
| 3 | 業界水準を満たすが際立った要素はない |
| 4 | 細部まで作り込まれ洗練されている |
| 5 | 業界をリードするレベル |

採点観点（10項目）:
1. ビジュアル完成度（配色・装飾要素）
2. タイポグラフィ品質（フォント選定・サイズ比・行間）
3. ファーストビューの訴求力（3秒以内に伝わるか）
4. 情報設計の明快さ（何をすべきか一目で分かるか）
5. ブランド一貫性（色・形・トーンの統一感）
6. 余白・スペーシングの設計品質
7. 独自性・差別化度（記憶に残るか）
8. 細部の作り込み（アイコン・シャドウ等）
9. 視覚的ヒエラルキーの明確さ
10. ターゲット適合度

${
  hasSpScreen
    ? `## ⑬ レスポンシブ対応品質採点基準（1〜5）
1枚目がPC、2枚目がSPのスクリーンショットです。

| スコア | 基準 |
|--------|------|
| 1 | SP表示で崩れ・横スクロール発生 |
| 2 | 横幅縮小のみ |
| 3 | 主要ブレークポイントでレイアウト変更あり |
| 4 | PC・SP双方で最適化された別レイアウト |
| 5 | モバイルファースト設計 |`
    : `## ⑬ レスポンシブ対応品質
SPスクリーンショットがないため採点不可。`
}

## 出力形式（必ずこのJSON形式のみで回答してください）

{
  "quality_score": 数値(1-5),
  "quality_reasons": ["理由1", "理由2", "理由3"],
  ${
    hasSpScreen
      ? `"responsive_score": 数値(1-5),
  "responsive_reasons": ["理由1", "理由2"]`
      : `"responsive_score": null,
  "responsive_reasons": []`
  }
}`;
}

// ============================================================
// レスポンスパース
// ============================================================
function parseScoreResponse(text: string, hasSpscreen: boolean): ScoreResult {
  // JSONを抽出
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`JSONが見つかりません: ${text.slice(0, 200)}`);

  const parsed = JSON.parse(match[0]);

  const quality_score = Math.min(
    5,
    Math.max(1, Math.round(Number(parsed.quality_score))),
  );
  const responsive_score =
    parsed.responsive_score != null
      ? Math.min(5, Math.max(1, Math.round(Number(parsed.responsive_score))))
      : null;

  return {
    quality_score,
    quality_reasons: Array.isArray(parsed.quality_reasons)
      ? parsed.quality_reasons
      : [],
    responsive_score,
    responsive_reasons: Array.isArray(parsed.responsive_reasons)
      ? parsed.responsive_reasons
      : [],
  };
}

// ============================================================
// 画像 → base64
// ============================================================
async function fetchImageAsBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`画像取得失敗: ${url} (${res.status})`);
  const buffer = await res.arrayBuffer();
  return Buffer.from(buffer).toString("base64");
}

// ============================================================
// 実行
// ============================================================
main().catch((err) => {
  console.error("[score] 予期しないエラー:", err);
  process.exit(1);
});
