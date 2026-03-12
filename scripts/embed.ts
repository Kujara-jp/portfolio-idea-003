/**
 * design-vault: Embedding生成スクリプト
 * ページのタグ・SEO・メタデータをテキスト化 → OpenAI text-embedding-3-small (1536次元) でembedding生成
 * Supabase pages.embedding (vector(1536)) に保存
 *
 * 実行方法:
 *   npx tsx scripts/embed.ts
 *   npx tsx scripts/embed.ts --limit=5
 *   npx tsx scripts/embed.ts --offset=100 --limit=50
 *   npx tsx scripts/embed.ts --re-embed   (全ページ再生成)
 */

import { createClient } from "@supabase/supabase-js";

// ============================================================
// 設定
// ============================================================
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const BATCH_LIMIT = limitArg ? parseInt(limitArg.split("=")[1]) : 50;
const RE_EMBED_MODE = args.includes("--re-embed");
const offsetArg = args.find((a) => a.startsWith("--offset="));
const OFFSET = offsetArg ? parseInt(offsetArg.split("=")[1]) : 0;

const OPENAI_BATCH_SIZE = 100; // OpenAI embeddingは1回100件まで

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================
// ページデータ型
// ============================================================
interface PageData {
  page_id: string;
  page_type: string | null;
  design_tone: string[] | null;
  color_scheme: string[] | null;
  layout_pattern: string[] | null;
  typography_tags: string[] | null;
  navigation_tags: string[] | null;
  conversion_tags: string[] | null;
  visual_material: string[] | null;
  responsive_score: number | null;
  seo_page_title: string | null;
  seo_meta_description: string | null;
  seo_h1_text: string | null;
  seo_catchcopy_text: string | null;
  sites: {
    quality_score: number | null;
    industry_category: string | null;
  };
}

// ============================================================
// テキスト化: ページデータ → embeddingインプット
// ============================================================
function buildEmbeddingText(page: PageData): string {
  const lines: string[] = [];

  const industry = page.sites?.industry_category;
  if (industry) lines.push(`業種: ${industry}`);

  if (page.page_type) lines.push(`ページ種別: ${page.page_type}`);

  const arrayField = (label: string, arr: string[] | null) => {
    if (arr && arr.length > 0) lines.push(`${label}: ${arr.join(", ")}`);
  };

  arrayField("デザイントーン", page.design_tone);
  arrayField("カラースキーム", page.color_scheme);
  arrayField("レイアウト", page.layout_pattern);
  arrayField("タイポグラフィ", page.typography_tags);
  arrayField("ナビゲーション", page.navigation_tags);
  arrayField("コンバージョン", page.conversion_tags);
  arrayField("ビジュアル素材", page.visual_material);

  if (page.sites?.quality_score != null)
    lines.push(`品質スコア: ${page.sites.quality_score}/5`);
  if (page.responsive_score != null)
    lines.push(`レスポンシブスコア: ${page.responsive_score}/5`);

  if (page.seo_page_title) lines.push(`タイトル: ${page.seo_page_title}`);
  if (page.seo_meta_description)
    lines.push(`概要: ${page.seo_meta_description}`);
  if (page.seo_h1_text) lines.push(`見出し: ${page.seo_h1_text}`);
  if (page.seo_catchcopy_text)
    lines.push(`キャッチコピー: ${page.seo_catchcopy_text}`);

  return lines.join("\n");
}

// ============================================================
// OpenAI Embedding API呼び出し（バッチ）
// ============================================================
async function getEmbeddings(
  texts: string[],
): Promise<{ embedding: number[] }[]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: texts,
    }),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(
      `OpenAI API error ${res.status}: ${errorBody}`,
    );
  }

  const json = await res.json();
  // OpenAI returns data sorted by index
  const sorted = (json.data as { index: number; embedding: number[] }[]).sort(
    (a, b) => a.index - b.index,
  );
  return sorted;
}

// ============================================================
// メイン
// ============================================================
async function main() {
  console.log(
    `[embed] 開始 mode=${RE_EMBED_MODE ? "re-embed" : "new"} limit=${BATCH_LIMIT} offset=${OFFSET}`,
  );

  // 対象ページ取得
  let query = supabase
    .from("pages")
    .select(
      `
      page_id, page_type,
      design_tone, color_scheme, layout_pattern,
      typography_tags, navigation_tags, conversion_tags, visual_material,
      responsive_score,
      seo_page_title, seo_meta_description, seo_h1_text, seo_catchcopy_text,
      sites (quality_score, industry_category)
    `,
    )
    .not("screenshot_pc", "is", null)
    .order("created_at", { ascending: true });

  if (!RE_EMBED_MODE) {
    query = query.is("embedding", null);
  }

  query = query.range(OFFSET, OFFSET + BATCH_LIMIT - 1);

  const { data: pages, error } = await query;

  if (error) {
    console.error("[embed] ❌ DB取得エラー:", error.message);
    process.exit(1);
  }

  if (!pages || pages.length === 0) {
    console.log("[embed] ✅ 対象ページなし（すべてembedding済み）");
    return;
  }

  console.log(`[embed] 対象: ${pages.length}件`);

  // テキスト化
  const texts = pages.map((p) => buildEmbeddingText(p as unknown as PageData));

  // バッチ処理
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < texts.length; i += OPENAI_BATCH_SIZE) {
    const batchTexts = texts.slice(i, i + OPENAI_BATCH_SIZE);
    const batchPages = pages.slice(i, i + OPENAI_BATCH_SIZE);

    console.log(
      `[embed] バッチ ${Math.floor(i / OPENAI_BATCH_SIZE) + 1}: ${batchTexts.length}件を処理中...`,
    );

    try {
      const results = await getEmbeddings(batchTexts);

      // 各ページのembeddingを保存
      for (let j = 0; j < batchPages.length; j++) {
        const page = batchPages[j];
        const embedding = results[j].embedding;

        // pgvectorはJSON配列として文字列で送る
        const embeddingStr = `[${embedding.join(",")}]`;

        const { error: updateError } = await supabase
          .from("pages")
          .update({ embedding: embeddingStr })
          .eq("page_id", page.page_id);

        if (updateError) {
          console.error(
            `[embed] ❌ ${page.page_id}: ${updateError.message}`,
          );
          errorCount++;
        } else {
          successCount++;
        }
      }
    } catch (err) {
      console.error(`[embed] ❌ OpenAI APIエラー:`, err);
      errorCount += batchTexts.length;
    }

    // レート制限を避けるため少し待機
    if (i + OPENAI_BATCH_SIZE < texts.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  console.log(
    `[embed] ✅ 完了: ${successCount}/${pages.length} 成功, ${errorCount} エラー`,
  );
}

main().catch((err) => {
  console.error("[embed] 致命的エラー:", err);
  process.exit(1);
});
