/**
 * design-vault: 採点スクリプト（Batch API版）
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

const POLL_INTERVAL_MS = 30_000; // 30秒おきにポーリング
const MAX_WAIT_MS = 25 * 60 * 1000; // 最大25分待機

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// ============================================================
// 型定義
// ============================================================
interface ScoreResult {
  is_blocked: boolean;
  quality_score: number;
  quality_reasons: string[];
  responsive_score: number | null;
  responsive_reasons: string[];
}

// ============================================================
// メイン処理
// ============================================================
async function main() {
  console.log(`[score] 開始（最大${BATCH_LIMIT}件）`);

  // 未採点のページを取得（ブロック済みは除外）
  const { data: pages, error } = await supabase
    .from("pages")
    .select("page_id, site_id, screenshot_pc, screenshot_sp, page_type")
    .is("responsive_score", null)
    .eq("is_blocked", false)
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

  console.log(`[score] ${pages.length}件をバッチ採点します`);

  // 画像を base64 に変換してバッチリクエストを構築
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const pageIds: string[] = [];

  for (const page of pages) {
    try {
      const pcBase64 = await fetchImageAsBase64(page.screenshot_pc);
      const hasSpScreenshot = !!page.screenshot_sp;
      const spBase64 = hasSpScreenshot
        ? await fetchImageAsBase64(page.screenshot_sp!)
        : null;

      // page_type は将来の採点基準拡張のために保持（現在は未使用）
      const prompt = buildScoringPrompt(hasSpScreenshot);
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

      requests.push({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [{ role: "user", content }],
      });
      pageIds.push(page.page_id);
    } catch (err) {
      console.error(`[score] 画像取得失敗 page_id=${page.page_id}:`, err);
    }
  }

  if (requests.length === 0) {
    console.log("[score] バッチリクエストなし。終了します。");
    return;
  }

  // Batch API にまとめて送信
  console.log(`[score] Batch API 送信中（${requests.length}件）...`);
  const batch = await anthropic.messages.batches.create({
    requests: requests.map((req, i) => ({
      custom_id: pageIds[i],
      params: req,
    })),
  });

  console.log(`[score] バッチID: ${batch.id} 完了待ち...`);

  // ポーリングで完了を待つ
  const startTime = Date.now();
  let batchResult = batch;
  while (batchResult.processing_status !== "ended") {
    if (Date.now() - startTime > MAX_WAIT_MS) {
      console.error("[score] タイムアウト。次回実行時に再試行されます。");
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    batchResult = await anthropic.messages.batches.retrieve(batch.id);
    console.log(`[score] ステータス: ${batchResult.processing_status}`);
  }

  // 結果を取得して Supabase に保存
  console.log("[score] 結果取得・DB更新中...");
  for await (const result of await anthropic.messages.batches.results(
    batch.id,
  )) {
    const pageId = result.custom_id;
    if (result.result.type !== "succeeded") {
      console.error(`[score] ❌ 失敗 page_id=${pageId}:`, result.result.type);
      continue;
    }

    try {
      const text = result.result.message.content
        .filter((c) => c.type === "text")
        .map((c) => (c as Anthropic.TextBlock).text)
        .join("");

      const page = pages.find((p) => p.page_id === pageId)!;
      const scored = parseScoreResponse(text, !!page.screenshot_sp);

      // ブロック検出: sites・pages 両方にフラグを立てて終了
      if (scored.is_blocked) {
        const { error: siteBlockError } = await supabase
          .from("sites")
          .update({ is_blocked: true, quality_score: null })
          .eq("site_id", page.site_id);
        if (siteBlockError)
          throw new Error(`sites ブロック更新エラー: ${siteBlockError.message}`);

        const { error: pageBlockError } = await supabase
          .from("pages")
          .update({
            is_blocked: true,
            responsive_score: null,
            needs_review: false,
          })
          .eq("page_id", pageId);
        if (pageBlockError)
          throw new Error(`pages ブロック更新エラー: ${pageBlockError.message}`);

        console.log(`[score] 🚫 ブロック検出 page_id=${pageId} → スキップ`);
        continue;
      }

      // sites テーブルのクオリティスコアを更新
      const { error: siteError } = await supabase
        .from("sites")
        .update({ quality_score: scored.quality_score })
        .eq("site_id", page.site_id);
      if (siteError) throw new Error(`sites 更新エラー: ${siteError.message}`);

      // pages テーブルのレスポンシブスコアを更新
      const { error: pageError } = await supabase
        .from("pages")
        .update({
          responsive_score: scored.responsive_score,
          needs_review: false,
        })
        .eq("page_id", pageId);
      if (pageError) throw new Error(`pages 更新エラー: ${pageError.message}`);

      console.log(
        `[score] ✅ 完了 quality=${scored.quality_score} responsive=${
          scored.responsive_score ?? "n/a"
        }`,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[score] ❌ エラー page_id=${pageId} - ${message}`);
    }
  }

  console.log("\n[score] 全処理完了");
}

// ============================================================
// Claude Vision API 採点プロンプト
// ============================================================
function buildScoringPrompt(hasSpScreenshot: boolean): string {
  return `
## 【最初に確認】ブロック・エラー判定
このスクリーンショットが以下のいずれかに該当する場合、is_blocked: true を返し、採点は行わないでください：
- アクセス拒否画面（403 Forbidden、Access Denied、Cloudflare Bot Check など）
- Captcha・人間確認画面
- 「このサイトにアクセスできません」などのブラウザエラー画面
- ページが空白・真っ白・ローディング中のまま
- サーバーエラー画面（500系エラー）

該当する場合の出力：
{
  "is_blocked": true,
  "quality_score": 1,
  "quality_reasons": ["ブロック・エラー画面のため採点不可"],
  "responsive_score": null,
  "responsive_reasons": []
}

上記に該当しない場合のみ、以下の採点を行ってください。

---

## ⑦ クオリティスコア
以下の基準で1〜5点で採点してください：
1 - 著しく品質が低い
2 - 品質に問題あり
3 - 標準的な品質
4 - 高品質
5 - 非常に高品質・洗練されている

## ⑬ レスポンシブ対応品質スコア
${
  hasSpScreenshot
    ? `SPスクリーンショットを参照して以下の基準で1〜5点で採点してください：
1 - レスポンシブ対応なし・崩れている
2 - 部分的に対応・問題あり
3 - 標準的な対応
4 - よく対応している
5 - 完全に最適化されたレスポンシブデザイン`
    : `SPスクリーンショットがないため採点不可。`
}

## 出力形式（必ずこのJSON形式のみで回答してください）
{
  "is_blocked": false,
  "quality_score": 数値(1-5),
  "quality_reasons": ["理由1", "理由2", "理由3"],
  ${
    hasSpScreenshot
      ? `"responsive_score": 数値(1-5),
  "responsive_reasons": ["理由1", "理由2"]`
      : `"responsive_score": null,
  "responsive_reasons": []`
  }
}
`.trim();
}

// ============================================================
// レスポンスパース
// ============================================================
function parseScoreResponse(text: string, hasSpscreen: boolean): ScoreResult {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`JSONが見つかりません: ${text.slice(0, 200)}`);

  const parsed = JSON.parse(match[0]);

  const is_blocked = parsed.is_blocked === true;

  const quality_score = Math.min(
    5,
    Math.max(1, Math.round(Number(parsed.quality_score))),
  );
  const responsive_score =
    parsed.responsive_score != null
      ? Math.min(5, Math.max(1, Math.round(Number(parsed.responsive_score))))
      : null;

  return {
    is_blocked,
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
