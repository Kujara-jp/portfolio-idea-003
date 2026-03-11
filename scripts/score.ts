/**
 * design-vault: 採点スクリプト（Batch API版）
 * スクリーンショットを Claude Vision API に送り、以下を自動採点する
 *   ⑦ クオリティスコア（1〜5）
 *   ⑬ レスポンシブ対応品質スコア（1〜5）
 *
 * 実行方法:
 *   npx tsx scripts/score.ts
 *   npx tsx scripts/score.ts --limit=5
 *   npx tsx scripts/score.ts --rescore --limit=5  (再キャリブレーション)
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
const RESCORE_MODE = args.includes("--rescore");

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
  has_overlay: boolean;
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
  console.log(`[score] 開始（最大${BATCH_LIMIT}件${RESCORE_MODE ? " / 再キャリブレーションモード" : ""}）`);

  // ページ取得（ブロック済みは除外）
  // rescore: 全ページ対象 / 通常: 未採点のみ
  let query = supabase
    .from("pages")
    .select("page_id, site_id, screenshot_pc, screenshot_sp, page_type, page_url, sites(url, target_user)")
    .or("is_blocked.eq.false,is_blocked.is.null")
    .not("screenshot_pc", "is", null)
    .limit(BATCH_LIMIT);

  if (!RESCORE_MODE) {
    query = query.is("responsive_score", null);
  }

  const { data: pages, error } = await query;

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

      // sites.target_user: ターゲット適合度評価のためプロンプトに渡す（AGENT.md準拠）
      // Supabase PostgREST: many-to-one JOINは単一オブジェクトで返る
      const siteRelation = page.sites;
      const siteData = (Array.isArray(siteRelation) ? siteRelation[0] : siteRelation) as
        | { url: string; target_user: string[] | null }
        | null
        | undefined;
      const targetUser = siteData?.target_user ?? undefined;
      const prompt = buildScoringPrompt(hasSpScreenshot, targetUser, page.page_type);
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

      if (scored.has_overlay) {
        console.warn(
          `[score] ⚠️ オーバーレイ検出 page_id=${pageId} → needs_review=true（再収集推奨）`,
        );
      }
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
// pageType別 追加評価基準
// ============================================================
const PAGE_TYPE_CRITERIA: Record<string, string> = {
  "コーポレートサイト": `追加評価ポイント:
- ブランドの信頼感・安心感が伝わるか
- 企業理念やビジョンが視覚的に表現されているか
- グローバルナビゲーションが明確で網羅的か`,

  "LP（ランディングページ）": `追加評価ポイント:
- CTAの視認性と誘導力（ファーストビューにCTAがあるか）
- コンバージョンへの導線設計（AIDMA/AISAS等のフロー）
- 信頼性要素（実績数・お客様の声・メディア掲載等）の配置`,

  "ECサイト": `追加評価ポイント:
- 商品写真の見せ方とグリッド設計
- 検索・フィルタのUIが直感的か
- 購入導線（カート追加→決済）の明快さ`,

  "採用サイト": `追加評価ポイント:
- ターゲット人材に刺さるビジュアル表現か
- 社風・カルチャーが視覚的に伝わるか
- エントリー導線の明確さ`,

  "ブログ・オウンドメディア": `追加評価ポイント:
- 記事の可読性（行間・文字サイズ・カラム幅）
- カテゴリ・タグの整理と回遊設計
- アイキャッチ画像の統一感`,

  "お問い合わせ": `追加評価ポイント:
- フォームの入力しやすさ（ラベル・バリデーション）
- 入力項目数の適切さ（多すぎないか）
- 送信前の安心感（プライバシーポリシーリンク等）`,

  "事例・実績": `追加評価ポイント:
- 事例の見せ方（ビフォーアフター・数値成果・ストーリー）
- フィルタ・検索による探しやすさ
- 個別事例ページへの誘導設計`,

  "商品・物件・案件詳細": `追加評価ポイント:
- 写真ギャラリーのUI（スワイプ・ズーム等）
- スペック・価格情報の視認性
- 関連商品・類似物件へのレコメンド導線`,
};

// ============================================================
// Claude Vision API 採点プロンプト
// ============================================================
function buildScoringPrompt(hasSpScreenshot: boolean, targetUser?: string[], pageType?: string): string {
  const extraCriteria = pageType ? PAGE_TYPE_CRITERIA[pageType] ?? null : null;
  const pageTypeSection = extraCriteria
    ? `\n\nこのページは「${pageType}」です。上記5基準に加えて以下も考慮:\n${extraCriteria}`
    : pageType && pageType !== "その他・未分類"
      ? `\nこのページは「${pageType}」です。種別の目的に照らして適切にデザインされているか考慮してください。`
      : '';

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

## Overlay / Obstruction Detection

If a cookie consent banner, promotional popup, coupon overlay, newsletter signup, or similar element covers a significant portion (>30%) of the page content, set "has_overlay": true in your response. This does NOT make the page blocked — score the design based on what you can see behind the overlay, but lower confidence to "medium" or "low" depending on severity.

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

Rate the overall visual design quality of the PC screenshot.

IMPORTANT: Be strict. Apply the following distribution as a guideline:
- Score 1 (~5%): Clearly broken, outdated, or unusable design
- Score 2 (~20%): Below average. Generic templates, poor spacing, weak typography
- Score 3 (~45%): Industry standard. Competent but unremarkable. Most professional sites belong here
- Score 4 (~25%): High quality. Polished details, strong visual hierarchy, memorable
- Score 5 (~5%): Exceptional. Award-winning level. Innovative, flawless execution

Do NOT default to 4. A "clean, professional site" is typically a 3. Score 4 requires something that stands out. Score 5 is reserved for sites you would submit to a design award.

Evaluate based on these 5 key criteria:
1. ビジュアル完成度と独自性（配色・装飾が洗練されているか、記憶に残るか）
2. タイポグラフィと余白設計（フォント選定・サイズ比・余白が意図的に設計されているか）
3. 情報設計とヒエラルキー（要素の優先度が明確で、3秒以内に目的が伝わるか）
4. ブランド一貫性と細部の作り込み（色・トーン統一、アイコン・シャドウ等の微細品質）
5. ターゲット適合度（デザインが想定ユーザーに適切か）
${
  targetUser && targetUser.length > 0
    ? `\nTarget user for criterion 5: ${targetUser.join(", ")}.`
    : ``
}${pageTypeSection}

Provide exactly 3 reasons in Japanese citing specific visual evidence.

## Step 3: Responsive Score (1-5)
${
  hasSpScreenshot
    ? `Compare the PC screenshot (1st image) and SP screenshot (2nd image).

Apply the same strict distribution as quality score:
- Score 1 (~5%): Not responsive at all. Broken on mobile
- Score 2 (~20%): Minimal effort. Just shrunk, no real optimization
- Score 3 (~45%): Standard responsive. Layout changes at breakpoints but nothing special
- Score 4 (~25%): Well optimized. Separate layouts, adjusted typography and spacing
- Score 5 (~5%): Mobile-first excellence. Touch-optimized, swipe UI, perfect adaptation

A site that "works on mobile" is a 3, not a 4.

Evaluate based on:
1. レイアウト変化の適切さ（PCとSPで適切に最適化されているか）
2. タイポグラフィ・余白・タップターゲットの最適化
3. ナビゲーションとコンテンツの取捨選択

Provide exactly 2 reasons in Japanese citing specific visual differences.`
    : `No SP screenshot available. Cannot evaluate responsive design.`
}

## Output Format (respond with ONLY this JSON, no other text)
{
  "is_blocked": false,
  "has_overlay": false,
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
  const has_overlay = parsed.has_overlay === true;

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
  // confidence が low、欠落/不正、スコア欠落、またはオーバーレイ検出の場合は needs_review を強制する
  const needs_review =
    confidence === "low" ||
    !["high", "medium", "low"].includes(rawConfidence) ||
    qualityMissing ||
    responsiveMissing ||
    has_overlay ||
    parsed.needs_review === true;

  return {
    is_blocked,
    has_overlay,
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
