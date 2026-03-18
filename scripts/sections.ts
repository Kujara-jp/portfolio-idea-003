/**
 * design-vault: セクション構造検出スクリプト（Batch API版）
 * スクリーンショット + sections_raw を Claude Haiku Vision API に送り、
 * 各セクションの型（section_type）を分類して page_sections テーブルに保存する
 *
 * 実行方法:
 *   npx tsx scripts/sections.ts                # 未検出ページを処理
 *   npx tsx scripts/sections.ts --limit=5      # 最大5件
 */

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

// ============================================================
// 設定
// ============================================================
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY!;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const BATCH_LIMIT = limitArg ? parseInt(limitArg.split("=")[1]) : 80;

const POLL_INTERVAL_MS = 30_000; // 30秒おきにポーリング
const MAX_WAIT_MS = 25 * 60 * 1000; // 最大25分待機

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// ============================================================
// セクションタイプ語彙（~25種）
// ============================================================
const SECTION_TYPES = [
  "hero",
  "navigation-header",
  "about-introduction",
  "service-list",
  "feature-highlight",
  "pricing-table",
  "menu-product-grid",
  "team-staff",
  "testimonials-reviews",
  "case-studies-portfolio",
  "news-blog-feed",
  "faq-accordion",
  "contact-form",
  "access-map",
  "cta-banner",
  "social-proof-logos",
  "timeline-history",
  "gallery-photos",
  "video-section",
  "stats-numbers",
  "newsletter-signup",
  "breadcrumbs",
  "sidebar",
  "instagram-feed",
  "footer",
] as const;

// ============================================================
// 型定義
// ============================================================
interface SectionResult {
  section_order: number;
  section_type: string;
  section_label: string | null;
  heading_text: string | null;
  has_cta: boolean;
  estimated_height_vh: number | null;
  dom_selector: string | null;
  visual_description: string | null;
}

interface SectionRaw {
  section_order: number;
  heading_text: string | null;
  has_cta: boolean;
  estimated_height_vh: number | null;
  dom_selector: string | null;
  classes: string[];
  id: string | null;
  tag_name: string;
}

// ============================================================
// メイン処理
// ============================================================
async function main() {
  console.log(`[sections] 開始（最大${BATCH_LIMIT}件）`);

  // sections_detected = false かつ sections_raw IS NOT NULL かつ screenshot_pc あり
  const { data: pages, error } = await supabase
    .from("pages")
    .select("page_id, screenshot_pc, page_url, page_type, sections_raw")
    .eq("sections_detected", false)
    .not("sections_raw", "is", null)
    .not("screenshot_pc", "is", null)
    .or("is_blocked.eq.false,is_blocked.is.null")
    .limit(BATCH_LIMIT);

  if (error) {
    console.error("[sections] ページ取得エラー:", error.message);
    process.exit(1);
  }

  if (!pages || pages.length === 0) {
    console.log("[sections] 処理対象なし。終了します。");
    return;
  }

  // sections_raw が空配列のページは除外
  const validPages = pages.filter(
    (p) => Array.isArray(p.sections_raw) && p.sections_raw.length > 0,
  );

  if (validPages.length === 0) {
    console.log("[sections] 有効なセクションデータを持つページがありません。終了します。");
    return;
  }

  console.log(`[sections] ${validPages.length}件をバッチ処理します`);

  // バッチリクエストを構築
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const pageIds: string[] = [];

  for (const page of validPages) {
    try {
      const imageBase64 = await fetchImageAsBase64(page.screenshot_pc);
      const prompt = buildSectionPrompt(
        page.sections_raw as SectionRaw[],
        page.page_type,
        page.page_url ?? "",
      );

      requests.push({
        model: "claude-haiku-4-5",
        max_tokens: 2048,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: imageBase64,
                },
              },
              { type: "text", text: prompt },
            ],
          },
        ],
      });
      pageIds.push(page.page_id);
    } catch (err) {
      console.error(
        `[sections] 画像取得失敗 page_id=${page.page_id}:`,
        err,
      );
    }
  }

  if (requests.length === 0) {
    console.log("[sections] バッチリクエストなし。終了します。");
    return;
  }

  // Batch API にまとめて送信
  console.log(`[sections] Batch API 送信中（${requests.length}件）...`);
  const batch = await anthropic.messages.batches.create({
    requests: requests.map((req, i) => ({
      custom_id: pageIds[i],
      params: req,
    })),
  });

  console.log(`[sections] バッチID: ${batch.id} 完了待ち...`);

  // ポーリングで完了を待つ
  const startTime = Date.now();
  let batchResult = batch;
  while (batchResult.processing_status !== "ended") {
    if (Date.now() - startTime > MAX_WAIT_MS) {
      console.error("[sections] タイムアウト。次回実行時に再試行されます。");
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    batchResult = await anthropic.messages.batches.retrieve(batch.id);
    console.log(`[sections] ステータス: ${batchResult.processing_status}`);
  }

  // 結果を取得して Supabase に保存
  console.log("[sections] 結果取得・DB更新中...");
  let successCount = 0;
  let errorCount = 0;

  for await (const result of await anthropic.messages.batches.results(
    batch.id,
  )) {
    const pageId = result.custom_id;
    if (result.result.type !== "succeeded") {
      console.error(
        `[sections] ❌ 失敗 page_id=${pageId}:`,
        result.result.type,
      );
      errorCount++;
      continue;
    }

    try {
      const text = result.result.message.content
        .filter((c) => c.type === "text")
        .map((c) => (c as Anthropic.TextBlock).text)
        .join("");

      const sections = parseSectionResponse(text);

      if (sections.length === 0) {
        console.warn(`[sections] ⚠️ セクション0件 page_id=${pageId}`);
        // sections_detected = true にして再処理を防ぐ
        await supabase
          .from("pages")
          .update({ sections_detected: true })
          .eq("page_id", pageId);
        continue;
      }

      // 既存の page_sections を削除してから INSERT（冪等性確保）
      await supabase
        .from("page_sections")
        .delete()
        .eq("page_id", pageId);

      // page_sections テーブルに INSERT
      const { error: insertError } = await supabase
        .from("page_sections")
        .insert(
          sections.map((s) => ({
            page_id: pageId,
            section_order: s.section_order,
            section_type: s.section_type,
            section_label: s.section_label,
            heading_text: s.heading_text,
            has_cta: s.has_cta,
            estimated_height_vh: s.estimated_height_vh,
            dom_selector: s.dom_selector,
            visual_description: s.visual_description,
          })),
        );

      if (insertError) {
        throw new Error(`page_sections INSERT エラー: ${insertError.message}`);
      }

      // pages.sections_detected = true に更新
      const { error: updateError } = await supabase
        .from("pages")
        .update({ sections_detected: true })
        .eq("page_id", pageId);

      if (updateError) {
        throw new Error(`pages 更新エラー: ${updateError.message}`);
      }

      successCount++;
      const typeList = sections.map((s) => s.section_type).join(" → ");
      console.log(`[sections] ✅ page_id=${pageId} (${sections.length}セクション)`);
      console.log(`[sections]   構成: ${typeList}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[sections] ❌ エラー page_id=${pageId} - ${message}`);
      errorCount++;
    }
  }

  console.log(
    `\n[sections] 全処理完了 成功=${successCount} エラー=${errorCount}`,
  );
}

// ============================================================
// プロンプト
// ============================================================
function buildSectionPrompt(
  sectionsRaw: SectionRaw[],
  pageType: string,
  pageUrl: string,
): string {
  const sectionsJson = JSON.stringify(
    sectionsRaw.map((s) => ({
      order: s.section_order,
      tag: s.tag_name,
      id: s.id,
      classes: s.classes.slice(0, 5),
      heading: s.heading_text,
      has_cta: s.has_cta,
      height_vh: s.estimated_height_vh,
    })),
    null,
    2,
  );

  return `あなたはWebデザイン構造の分析専門家です。スクリーンショットとDOM解析結果を照合し、各セクションの種類を分類してください。

## ページ情報
- URL: ${pageUrl}
- page_type: ${pageType}

## DOM解析結果（sections_raw）
\`\`\`json
${sectionsJson}
\`\`\`

## セクションタイプ候補（必ずこの中から選択）
${SECTION_TYPES.join(", ")}

## 分類ルール
- スクリーンショットの視覚情報とDOM解析結果（class名、id、見出しテキスト、CTAの有無）を総合的に判断する
- 各セクションに最も適切なタイプを1つ選ぶ
- DOM解析結果の order 番号をそのまま section_order として使用する
- section_label: そのセクションの簡潔な説明（日本語、20字以内）
- visual_description: スクリーンショットから見たセクションの視覚的な特徴を簡潔に記述（日本語、50字以内）
- heading_text, has_cta, estimated_height_vh, dom_selector はDOM解析結果からそのまま引き継ぐ
- ナビゲーション要素（nav/header）は navigation-header に分類
- フッターは footer に分類
- 明らかにページ構造に含まれない小さなユーティリティ要素（20vh未満かつclass名から判断可能なもの）はスキップしてよい

## 出力形式（必ずこのJSON配列形式のみで回答）
[
  {
    "section_order": 0,
    "section_type": "navigation-header",
    "section_label": "グローバルナビ",
    "heading_text": null,
    "has_cta": false,
    "estimated_height_vh": 8,
    "dom_selector": "header.site-header",
    "visual_description": "白背景のシンプルなヘッダーナビ"
  },
  {
    "section_order": 1,
    "section_type": "hero",
    "section_label": "メインビジュアル",
    "heading_text": "見出しテキスト",
    "has_cta": true,
    "estimated_height_vh": 100,
    "dom_selector": "section.hero",
    "visual_description": "フルスクリーンの写真背景にキャッチコピーとCTAボタン"
  }
]`;
}

// ============================================================
// レスポンスパース
// ============================================================
function parseSectionResponse(text: string): SectionResult[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error(`JSON配列が見つかりません: ${text.slice(0, 200)}`);

  const parsed = JSON.parse(match[0]);

  if (!Array.isArray(parsed)) {
    throw new Error(`パース結果が配列ではありません`);
  }

  const validTypes = new Set<string>(SECTION_TYPES);

  return (parsed as unknown[])
    .filter(
      (s): s is Record<string, unknown> =>
        typeof s === "object" &&
        s !== null &&
        typeof (s as Record<string, unknown>).section_order === "number" &&
        typeof (s as Record<string, unknown>).section_type === "string" &&
        validTypes.has((s as Record<string, unknown>).section_type as string),
    )
    .map((s) => ({
      section_order: s.section_order as number,
      section_type: s.section_type as string,
      section_label:
        typeof s.section_label === "string" ? s.section_label : null,
      heading_text:
        typeof s.heading_text === "string" ? s.heading_text : null,
      has_cta: typeof s.has_cta === "boolean" ? s.has_cta : false,
      estimated_height_vh:
        typeof s.estimated_height_vh === "number"
          ? s.estimated_height_vh
          : null,
      dom_selector:
        typeof s.dom_selector === "string" ? s.dom_selector : null,
      visual_description:
        typeof s.visual_description === "string"
          ? s.visual_description
          : null,
    }));
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
  console.error("[sections] 予期しないエラー:", err);
  process.exit(1);
});
