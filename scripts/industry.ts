/**
 * design-vault: 業種分類スクリプト（Batch API版）
 * サイトのホームページスクリーンショットから業種カテゴリ・業種タグを自動付与する
 *   ① 業種カテゴリ（sites.industry_category）
 *   ② 業種タグ（sites.industry_tags）
 *
 * 実行方法:
 *   npx tsx scripts/industry.ts
 *   npx tsx scripts/industry.ts --limit=50
 */

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

// ============================================================
// 設定
// ============================================================
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const BATCH_LIMIT = limitArg ? parseInt(limitArg.split("=")[1]) : 50;

const POLL_INTERVAL_MS = 30_000;
const MAX_WAIT_MS = 25 * 60 * 1000;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// ============================================================
// 業種カテゴリ定義（1つ選択）
// ============================================================
const INDUSTRY_CATEGORIES = [
  "テクノロジー・SaaS",
  "EC・小売",
  "飲食・フード",
  "ファッション・アパレル",
  "美容・コスメ",
  "不動産・建築",
  "旅行・観光・ホテル",
  "医療・ヘルスケア",
  "教育・学術",
  "金融・保険",
  "メディア・エンターテイメント",
  "製造・工業",
  "デザイン・クリエイティブ",
  "広告・マーケティング",
  "コンサルティング・士業",
  "人材・HR",
  "自動車・モビリティ",
  "スポーツ・フィットネス",
  "NPO・公共・自治体",
  "その他",
];

// ============================================================
// 業種タグ定義（複数選択）
// ============================================================
const INDUSTRY_TAGS = [
  "B2B",
  "B2C",
  "D2C",
  "SaaS",
  "プラットフォーム",
  "マーケットプレイス",
  "サブスクリプション",
  "エージェンシー",
  "ポートフォリオ",
  "ブランドサイト",
  "コーポレートサイト",
  "スタートアップ",
  "大企業・上場企業",
  "個人・フリーランス",
  "グローバル展開",
];

// ============================================================
// 型定義
// ============================================================
interface IndustryResult {
  industry_category: string;
  industry_tags: string[];
}

// ============================================================
// メイン処理
// ============================================================
async function main() {
  console.log(`[industry] 開始（最大${BATCH_LIMIT}件）`);

  // 業種未分類のサイトを取得（ブロック除外）
  const { data: sites, error } = await supabase
    .from("sites")
    .select("site_id, url, name")
    .or("industry_category.is.null,industry_category.eq.")
    .or("is_blocked.eq.false,is_blocked.is.null")
    .limit(BATCH_LIMIT);

  if (error) {
    console.error("[industry] サイト取得エラー:", error.message);
    process.exit(1);
  }

  if (!sites || sites.length === 0) {
    console.log("[industry] 分類対象なし。終了します。");
    return;
  }

  console.log(`[industry] ${sites.length}件を業種分類します`);

  // 各サイトのホームページスクリーンショットを取得
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const siteIds: string[] = [];

  for (const site of sites) {
    try {
      // そのサイトの最初のページ（ホームページ）のスクリーンショットを取得
      const { data: page } = await supabase
        .from("pages")
        .select("screenshot_pc")
        .eq("site_id", site.site_id)
        .not("screenshot_pc", "is", null)
        .order("created_at", { ascending: true })
        .limit(1)
        .single();

      if (!page?.screenshot_pc) {
        console.warn(
          `[industry] スクリーンショットなし site_id=${site.site_id}`,
        );
        continue;
      }

      const imageBase64 = await fetchImageAsBase64(page.screenshot_pc);

      requests.push({
        model: "claude-haiku-4-5",
        max_tokens: 512,
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
              {
                type: "text",
                text: buildIndustryPrompt(site.url, site.name),
              },
            ],
          },
        ],
      });
      siteIds.push(site.site_id);
    } catch (err) {
      console.error(
        `[industry] 画像取得失敗 site_id=${site.site_id}:`,
        err,
      );
    }
  }

  if (requests.length === 0) {
    console.log("[industry] バッチリクエストなし。終了します。");
    return;
  }

  // Batch API 送信
  console.log(`[industry] Batch API 送信中（${requests.length}件）...`);
  const batch = await anthropic.messages.batches.create({
    requests: requests.map((req, i) => ({
      custom_id: siteIds[i],
      params: req,
    })),
  });

  console.log(`[industry] バッチID: ${batch.id} 完了待ち...`);

  // ポーリング
  const startTime = Date.now();
  let batchResult = batch;
  while (batchResult.processing_status !== "ended") {
    if (Date.now() - startTime > MAX_WAIT_MS) {
      console.error("[industry] タイムアウト。次回実行時に再試行されます。");
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    batchResult = await anthropic.messages.batches.retrieve(batch.id);
    console.log(`[industry] ステータス: ${batchResult.processing_status}`);
  }

  // 結果を取得して Supabase に保存
  console.log("[industry] 結果取得・DB更新中...");
  let successCount = 0;
  let errorCount = 0;

  for await (const result of await anthropic.messages.batches.results(
    batch.id,
  )) {
    const siteId = result.custom_id;
    if (result.result.type !== "succeeded") {
      console.error(
        `[industry] 失敗 site_id=${siteId}:`,
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

      const classified = parseIndustryResponse(text);

      const { error: updateError } = await supabase
        .from("sites")
        .update({
          industry_category: classified.industry_category,
          industry_tags: classified.industry_tags,
        })
        .eq("site_id", siteId);

      if (updateError)
        throw new Error(`sites 更新エラー: ${updateError.message}`);

      successCount++;
      console.log(
        `[industry] 完了: ${classified.industry_category} [${classified.industry_tags.join(", ")}]`,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[industry] エラー site_id=${siteId} - ${message}`);
      errorCount++;
    }
  }

  console.log(
    `\n[industry] 全処理完了（成功: ${successCount}件, エラー: ${errorCount}件）`,
  );
}

// ============================================================
// プロンプト
// ============================================================
function buildIndustryPrompt(url: string, name: string): string {
  return `あなたはビジネスアナリストです。このWebサイトのスクリーンショットを見て、業種を分類してください。

## サイト情報
- URL: ${url}
- サイト名: ${name}

## 分類ルール
- industry_category: 以下の候補から最も適切な1つを選ぶ
- industry_tags: 以下の候補から当てはまるものを1〜3個選ぶ
- 確信が持てないタグは選ばない
- 候補にないものは選ばない

## 業種カテゴリ（候補・1つ選択）
${INDUSTRY_CATEGORIES.join("、")}

## 業種タグ（候補・1〜3個選択）
${INDUSTRY_TAGS.join("、")}

## 出力形式（必ずこのJSON形式のみで回答してください）
{
  "industry_category": "カテゴリ名",
  "industry_tags": ["タグ1", "タグ2"]
}`;
}

// ============================================================
// レスポンスパース
// ============================================================
function parseIndustryResponse(text: string): IndustryResult {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`JSONが見つかりません: ${text.slice(0, 200)}`);

  const parsed = JSON.parse(match[0]);

  const category =
    typeof parsed.industry_category === "string" &&
    INDUSTRY_CATEGORIES.includes(parsed.industry_category)
      ? parsed.industry_category
      : "その他";

  const tags = Array.isArray(parsed.industry_tags)
    ? parsed.industry_tags.filter(
        (t: unknown) => typeof t === "string" && INDUSTRY_TAGS.includes(t),
      )
    : [];

  return { industry_category: category, industry_tags: tags };
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
  console.error("[industry] 予期しないエラー:", err);
  process.exit(1);
});
