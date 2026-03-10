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
type Confidence = "high" | "medium" | "low";

interface ScoreResult {
  is_blocked: boolean;
  quality_score: number | null;
  quality_reasons: string[];
  responsive_score: number | null;
  responsive_reasons: string[];
  confidence: Confidence;
  needs_review: boolean;
}

// ============================================================
// メイン処理
// ============================================================
async function main() {
  console.log(`[score] 開始（最大${BATCH_LIMIT}件）`);

  // 未採点のページを取得（ブロック済みは除外）
  // sites.target_user をJOINで取得（⑦クオリティスコアのターゲット適合度評価に必要）
  const { data: pages, error } = await supabase
    .from("pages")
    .select("page_id, site_id, screenshot_pc, screenshot_sp, page_type, page_url, sites(url, target_user)")
    .is("responsive_score", null)
    .or("is_blocked.eq.false,is_blocked.is.null")
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
      // sites.target_user: ターゲット適合度評価のためプロンプトに渡す（AGENT.md準拠）
      // Supabase PostgREST: many-to-one JOINは単一オブジェクトで返る
      const siteRelation = page.sites;
      const siteData = (Array.isArray(siteRelation) ? siteRelation[0] : siteRelation) as
        | { url: string; target_user: string[] | null }
        | null
        | undefined;
      const targetUser = siteData?.target_user ?? undefined;
      const prompt = buildScoringPrompt(hasSpScreenshot, targetUser);
      const pcMediaType = detectMediaType(page.screenshot_pc);
      const spMediaType = page.screenshot_sp
        ? detectMediaType(page.screenshot_sp)
        : pcMediaType;
      const content: Anthropic.MessageParam["content"] = [
        {
          type: "image",
          source: { type: "base64", media_type: pcMediaType, data: pcBase64 },
        },
        ...(spBase64
          ? [
              {
                type: "image" as const,
                source: {
                  type: "base64" as const,
                  media_type: spMediaType as "image/webp",
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

      // ホームページ判定: page_url と sites.url を比較
      // page_type ではなく URL で判定（その他・未分類はサブページにも使われるため）
      const pageSite = (Array.isArray(page.sites) ? page.sites[0] : page.sites) as
        | { url: string; target_user: string[] | null }
        | null
        | undefined;
      const isHomepage = !!(
        pageSite?.url &&
        page.page_url &&
        normalizeUrl(page.page_url) === normalizeUrl(pageSite.url)
      );

      // ブロック検出: pages にフラグを立てて終了
      // AGENT.md準拠: ブロック時は pages.needs_review=false
      // サイトレベルのブロックはホームページの場合のみ
      if (scored.is_blocked) {

        if (isHomepage) {
          const { error: siteBlockError } = await supabase
            .from("sites")
            .update({
              is_blocked: true,
              quality_score: null,
            })
            .eq("site_id", page.site_id);
          if (siteBlockError)
            throw new Error(`sites ブロック更新エラー: ${siteBlockError.message}`);
        }

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

        console.log(`[score] 🚫 ブロック検出 page_id=${pageId} (${page.page_type}) → スキップ`);
        continue;
      }

      // sites テーブルのクオリティスコアを更新（ホームページの場合のみ）
      // サブページのスコアでサイト代表値を上書きしない
      // needs_reviewはtrueの場合のみ設定（他スクリプトがsite-levelで立てたフラグを消さないため）
      if (isHomepage) {
        const siteUpdate: Record<string, unknown> = {
          quality_score: scored.quality_score,
        };
        if (scored.needs_review) {
          siteUpdate.needs_review = true;
        }
        const { error: siteError } = await supabase
          .from("sites")
          .update(siteUpdate)
          .eq("site_id", page.site_id);
        if (siteError) throw new Error(`sites 更新エラー: ${siteError.message}`);
      } else if (scored.needs_review) {
        // サブページでも needs_review は反映（one-way true）
        const { error: siteError } = await supabase
          .from("sites")
          .update({ needs_review: true })
          .eq("site_id", page.site_id);
        if (siteError) throw new Error(`sites 更新エラー: ${siteError.message}`);
      }

      // pages テーブルのレスポンシブスコアを更新
      const { error: pageError } = await supabase
        .from("pages")
        .update({
          responsive_score: scored.responsive_score,
          needs_review: scored.needs_review,
        })
        .eq("page_id", pageId);
      if (pageError) throw new Error(`pages 更新エラー: ${pageError.message}`);

      if (scored.quality_score == null) {
        console.warn(
          `[score] ⚠️ quality_score欠落 page_id=${pageId} → needs_review=true`,
        );
      }
      if (page.screenshot_sp && scored.responsive_score == null) {
        console.warn(
          `[score] ⚠️ responsive_score欠落（SP有り） page_id=${pageId} → needs_review=true`,
        );
      }

      console.log(
        `[score] ✅ 完了 quality=${scored.quality_score ?? "null"} responsive=${
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
function buildScoringPrompt(hasSpScreenshot: boolean, targetUser?: string[]): string {
  return `
You are a web design evaluator. Score based primarily on what is visually observable in the screenshot(s). Do not guess or assume anything not visible, except when target user information is provided below for evaluating target fit.

## Step 1: Block / Error Detection

If the screenshot clearly shows one of these PERMANENT error states, return is_blocked: true and skip scoring:
- HTTP error page (403 Forbidden, 500 Internal Server Error, 502, 503, etc.)
- NOTE: Do NOT block 404 pages. Custom 404 pages are valid design samples and should be scored normally.
- Access denied / Cloudflare bot-check / WAF block page
- CAPTCHA or human-verification interstitial
- Browser-level error ("This site can't be reached", DNS failure, connection refused, etc.)

Also block if the page is completely blank/white with no content rendered at all, or shows only a loading spinner or skeleton placeholders with no actual content.

IMPORTANT: Do NOT mark as blocked if the page has a minimalist design or intentional whitespace. These are valid design choices, not errors. A page with any intentional content (logo, text, navigation) is NOT blank even if the layout is very sparse.

If blocked:
{
  "is_blocked": true,
  "quality_score": null,
  "quality_reasons": ["ブロック・エラーページのため採点不可"],
  "responsive_score": null,
  "responsive_reasons": [],
  "confidence": "high",
  "needs_review": false
}

If NOT blocked, proceed to scoring below.

---

## Step 2: Quality Score (1-5)

Rate the overall visual design quality of the PC screenshot using the following scale:

| Score | 評価 | 基準 |
|-------|------|------|
| 1 | 低品質 | 問題が複数あり参考にならない |
| 2 | 平均以下 | 業界水準を下回る。改善余地が多い |
| 3 | 標準 | 業界水準を満たすが際立った要素はない |
| 4 | 高品質 | 細部まで作り込まれ洗練されている |
| 5 | 傑出 | 業界をリードするレベル |

Evaluate based on the following 10 criteria:
1. ビジュアル完成度（配色・装飾要素の完成度）
2. タイポグラフィ品質（フォント選定・サイズ比・行間・字間）
3. ファーストビューの訴求力（3秒以内に何のサイトか・誰向けかが伝わるか）
4. 情報設計の明快さ（ページ全体で何をすべきかが一目で分かるか）
5. ブランド一貫性（色・形・トーンが全体を通して統一されているか）
6. 余白・スペーシングの設計品質（余白が意図的に設計されているか）
7. 独自性・差別化度（記憶に残るか。「どこかで見た」感がないか）
8. 細部の作り込み（アイコン・シャドウ・境界線等の微細な品質）
9. 視覚的ヒエラルキーの明確さ（要素の重要度が大きさ・色・位置で明確に表現されているか）
10. ターゲット適合度（デザインのトーン・内容がターゲットユーザーに適合しているか）
${
  targetUser && targetUser.length > 0
    ? `\nTarget user for criterion 10: ${targetUser.join(", ")}. Evaluate whether the design is appropriate for this audience.`
    : `\nNo target user information available for criterion 10. Evaluate based on what the design itself implies about its intended audience.`
}

Provide exactly 3 reasons in Japanese citing specific visual evidence from the above criteria.

## Step 3: Responsive Score (1-5)
${
  hasSpScreenshot
    ? `Compare the PC screenshot (1st image) and SP screenshot (2nd image) side by side to evaluate responsive design quality.

| Score | 評価 | 基準 |
|-------|------|------|
| 1 | 未対応 | SP表示で崩れ・横スクロール発生・実用不可 |
| 2 | 最低限対応 | 横幅縮小のみ。テキスト・画像が小さくなるだけ |
| 3 | 標準対応 | 主要ブレークポイントでレイアウト変更あり |
| 4 | 高品質対応 | PC・SP双方で最適化された別レイアウト。余白・フォントも最適化 |
| 5 | モバイルファースト設計 | SPを主軸に設計。タップターゲット・スワイプUI等まで最適化 |

Evaluate based on the following 7 criteria:
1. レイアウト変化の適切さ（PCとSPで別レイアウトに最適化されているか）
2. フォント・余白の最適化（SP時にフォントサイズ・余白が調整されているか）
3. タップターゲットの適切さ（ボタン・リンクがSPで押しやすいサイズか）
4. 画像・メディアの最適化（SP時に画像サイズ・アスペクト比が適切か）
5. ナビゲーションの変化（PCナビがSP用に適切に変化しているか）
6. フォーム・入力UIのSP最適化（テキスト入力・セレクトボックス等のSP操作性）
7. SP時のコンテンツ取捨選択（情報の優先順位づけが適切に行われているか）

Provide exactly 2 reasons in Japanese citing specific visual differences between PC and SP.`
    : `No SP screenshot available. Cannot evaluate responsive design.`
}

## Output Format (respond with ONLY this JSON, no other text)
{
  "is_blocked": false,
  "quality_score": <integer 1-5>,
  "quality_reasons": ["<根拠1>", "<根拠2>", "<根拠3>"],
  ${
    hasSpScreenshot
      ? `"responsive_score": <integer 1-5>,
  "responsive_reasons": ["<根拠1>", "<根拠2>"]`
      : `"responsive_score": null,
  "responsive_reasons": []`
  },
  "confidence": "<high or medium or low>",
  "needs_review": false
}

- confidence が "low" の場合は needs_review を true にすること
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

  // ブロック時はスコアをnullで返す（AGENT.md準拠: センチネル値禁止）
  // NaN（非数値レスポンス "N/A" 等）もnullとして扱う
  const rawQuality = Number(parsed.quality_score);
  const quality_score =
    is_blocked || parsed.quality_score == null || Number.isNaN(rawQuality)
      ? null
      : Math.min(5, Math.max(1, Math.round(rawQuality)));
  const rawResponsive = Number(parsed.responsive_score);
  const responsive_score =
    is_blocked || parsed.responsive_score == null || Number.isNaN(rawResponsive)
      ? null
      : Math.min(5, Math.max(1, Math.round(rawResponsive)));

  // 非ブロックなのにスコアが欠落している場合はneeds_review強制
  const qualityMissing = !is_blocked && quality_score == null;
  // SP画像ありなのにresponsive_scoreが欠落している場合もneeds_review強制
  const responsiveMissing = !is_blocked && hasSpscreen && responsive_score == null;

  // confidence判定: 欠落・不正値の場合はlowとして扱い、needs_review強制（AGENT.md準拠）
  const rawConfidence = parsed.confidence;
  const confidence: Confidence =
    rawConfidence === "high"
      ? "high"
      : rawConfidence === "medium"
        ? "medium"
        : "low";
  // confidence が low、欠落/不正、またはスコア欠落の場合は needs_review を強制する
  const needs_review =
    confidence === "low" ||
    !["high", "medium", "low"].includes(rawConfidence) ||
    qualityMissing ||
    responsiveMissing ||
    parsed.needs_review === true;

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
    confidence,
    needs_review,
  };
}

// ============================================================
// 画像メディアタイプ判定
// ============================================================
function detectMediaType(
  url: string,
): "image/webp" | "image/png" | "image/jpeg" | "image/gif" {
  const lower = url.toLowerCase();
  if (lower.includes(".webp")) return "image/webp";
  if (lower.includes(".png")) return "image/png";
  if (lower.includes(".jpg") || lower.includes(".jpeg")) return "image/jpeg";
  if (lower.includes(".gif")) return "image/gif";
  // AGENT.md: スクリーンショットはWebP形式で保存
  return "image/webp";
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
// URL正規化（ホームページ判定用）
// ============================================================
function normalizeUrl(url: string): string {
  return url.toLowerCase().replace(/\/$/, "").replace(/^https?:\/\//, "");
}

// ============================================================
// 実行
// ============================================================
main().catch((err) => {
  console.error("[score] 予期しないエラー:", err);
  process.exit(1);
});
