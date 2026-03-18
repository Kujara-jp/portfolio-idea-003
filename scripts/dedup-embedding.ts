/**
 * design-vault: Embedding ベース重複検出スクリプト
 *
 * URL 正規化だけでは検出できない「内容が同じ / 極めて類似したページ」を
 * pgvector コサイン類似度で検出する。
 *
 * 安全設計:
 *   - デフォルトは --dry-run（削除しない、レポートのみ）
 *   - --execute を明示した場合のみ削除を実行
 *   - 類似度 0.98 以上を「重複候補」と判定（調整可能）
 *   - embedding が null のページは対象外
 *
 * 実行方法:
 *   npx tsx scripts/dedup-embedding.ts --dry-run           # レポートのみ（デフォルト）
 *   npx tsx scripts/dedup-embedding.ts --execute           # 削除実行
 *   npx tsx scripts/dedup-embedding.ts --threshold=0.97    # しきい値を下げる（より多く検出）
 *   npx tsx scripts/dedup-embedding.ts --limit=500         # 検査ページ数を制限
 *
 * 環境変数:
 *   SUPABASE_URL               Supabase プロジェクト URL
 *   SUPABASE_SERVICE_ROLE_KEY  サービスロールキー
 */

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "fs";

// ============================================================
// 設定
// ============================================================
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!;

const args = process.argv.slice(2);
const DRY_RUN = !args.includes("--execute");
const thresholdArg = args.find((a) => a.startsWith("--threshold="));
const limitArg = args.find((a) => a.startsWith("--limit="));
const outputArg = args.find((a) => a.startsWith("--output="));

// コサイン類似度しきい値（1.0 = 完全一致）
// 0.98 以上を「高信頼度の重複」として扱う
const SIMILARITY_THRESHOLD = thresholdArg
  ? parseFloat(thresholdArg.split("=")[1])
  : 0.98;

// 検査対象の最大ページ数（メモリ節約のため）
const CHECK_LIMIT = limitArg ? parseInt(limitArg.split("=")[1]) : 2000;

// レポート出力先
const REPORT_PATH = outputArg
  ? outputArg.split("=")[1]
  : "./dedup_embedding_report.json";

// ============================================================
// 型定義
// ============================================================
interface PageRow {
  page_id: string;
  site_id: string;
  page_url: string | null;
  page_type: string | null;
  screenshot_pc: string | null;
  responsive_score: number | null;
  design_tone: string[] | null;
  created_at: string;
  // embedding は数値配列として返される
  embedding: number[] | null;
}

interface DuplicatePair {
  page_id_a: string;
  page_url_a: string | null;
  site_id_a: string;
  page_id_b: string;
  page_url_b: string | null;
  site_id_b: string;
  similarity: number;
  recommendation: "delete_b" | "review";
}

// ============================================================
// メイン処理
// ============================================================
async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("[dedup-embed] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です");
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  console.log(
    `[dedup-embed] 開始 (mode=${DRY_RUN ? "dry-run" : "execute"}, threshold=${SIMILARITY_THRESHOLD}, limit=${CHECK_LIMIT})`,
  );

  // Embedding 付きページを取得
  console.log("[dedup-embed] Embedding 付きページを取得中...");
  const pages = await fetchPagesWithEmbedding(supabase);

  if (pages.length === 0) {
    console.log("[dedup-embed] Embedding 付きページが見つかりません。embed.ts を先に実行してください。");
    return;
  }

  console.log(`[dedup-embed] ${pages.length} ページの embedding を読み込みました`);

  // コサイン類似度で重複候補を検出
  console.log("[dedup-embed] 重複候補を検出中...");
  const duplicates = findDuplicates(pages);

  console.log(`[dedup-embed] 重複候補: ${duplicates.length} ペア検出`);

  // レポートを生成
  const report = {
    checkedAt: new Date().toISOString(),
    mode: DRY_RUN ? "dry-run" : "execute",
    threshold: SIMILARITY_THRESHOLD,
    checkedPages: pages.length,
    duplicatePairs: duplicates.length,
    pairs: duplicates,
  };

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");
  console.log(`[dedup-embed] レポート出力: ${REPORT_PATH}`);

  // GitHub Actions サマリーに出力
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    const summaryContent = buildMarkdownReport(report);
    writeFileSync(summaryFile, summaryContent, { flag: "a" });
  }

  if (duplicates.length === 0) {
    console.log("[dedup-embed] 重複なし。完了。");
    return;
  }

  // 重複を表示
  printDuplicates(duplicates);

  // --execute モードでのみ削除実行
  if (!DRY_RUN) {
    await executeDeletion(supabase, duplicates);
  } else {
    console.log(
      `\n[dedup-embed] dry-run モードのため削除はスキップされました。\n` +
      `削除を実行するには --execute オプションを付けて再実行してください。`,
    );
  }
}

// ============================================================
// Embedding 付きページを取得
// ============================================================
async function fetchPagesWithEmbedding(
  supabase: ReturnType<typeof createClient>,
): Promise<PageRow[]> {
  const PAGE_SIZE = 500;
  const allPages: PageRow[] = [];
  let offset = 0;

  while (allPages.length < CHECK_LIMIT) {
    const { data, error } = await supabase
      .from("pages")
      .select(
        "page_id, site_id, page_url, page_type, screenshot_pc, responsive_score, design_tone, created_at, embedding",
      )
      .not("embedding", "is", null)
      .is("deleted_at", null)
      .eq("is_blocked", false)
      .range(offset, offset + PAGE_SIZE - 1)
      .order("created_at", { ascending: true });

    if (error) {
      throw new Error(`pages取得エラー (offset=${offset}): ${error.message}`);
    }

    if (!data || data.length === 0) break;

    allPages.push(...(data as PageRow[]));
    console.log(`[dedup-embed]   ${allPages.length} 件取得済み...`);

    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return allPages.slice(0, CHECK_LIMIT);
}

// ============================================================
// コサイン類似度計算
// ============================================================
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ============================================================
// 重複候補検出（O(n²) ペアワイズ比較）
// ============================================================
function findDuplicates(pages: PageRow[]): DuplicatePair[] {
  const duplicates: DuplicatePair[] = [];
  // 処理済みペアを追跡（A-B と B-A を重複検出しない）
  const processed = new Set<string>();

  for (let i = 0; i < pages.length; i++) {
    const pageA = pages[i];
    if (!pageA.embedding) continue;

    for (let j = i + 1; j < pages.length; j++) {
      const pageB = pages[j];
      if (!pageB.embedding) continue;

      // 同一サイト内の重複は dedup.ts が担当するためスキップ
      // ただし同一サイト・同一URLの場合は検出対象にする
      if (pageA.site_id === pageB.site_id && pageA.page_url !== pageB.page_url) {
        continue;
      }

      const pairKey = [pageA.page_id, pageB.page_id].sort().join("::");
      if (processed.has(pairKey)) continue;
      processed.add(pairKey);

      const similarity = cosineSimilarity(pageA.embedding, pageB.embedding);

      if (similarity >= SIMILARITY_THRESHOLD) {
        // カノニカルを決定: screenshot_pc 有 > responsive_score 高 > created_at 古
        const isABetter = selectBetter(pageA, pageB) === "a";

        duplicates.push({
          page_id_a: isABetter ? pageA.page_id : pageB.page_id,
          page_url_a: isABetter ? pageA.page_url : pageB.page_url,
          site_id_a: isABetter ? pageA.site_id : pageB.site_id,
          page_id_b: isABetter ? pageB.page_id : pageA.page_id,
          page_url_b: isABetter ? pageB.page_url : pageA.page_url,
          site_id_b: isABetter ? pageB.site_id : pageA.site_id,
          similarity: Math.round(similarity * 10000) / 10000,
          // 0.99以上は自動削除推奨、0.98-0.99はレビュー推奨
          recommendation: similarity >= 0.99 ? "delete_b" : "review",
        });
      }
    }

    // 進捗表示（100件ごと）
    if ((i + 1) % 100 === 0) {
      process.stdout.write(`\r[dedup-embed]   ${i + 1}/${pages.length} 件処理中...`);
    }
  }

  if (pages.length >= 100) process.stdout.write("\n");

  // 類似度の高い順にソート
  return duplicates.sort((a, b) => b.similarity - a.similarity);
}

// ============================================================
// カノニカルページの選定
// ============================================================
function selectBetter(a: PageRow, b: PageRow): "a" | "b" {
  // スクリーンショット有り優先
  if (!!a.screenshot_pc !== !!b.screenshot_pc) {
    return a.screenshot_pc ? "a" : "b";
  }
  // responsive_score 高い方優先
  const aScore = a.responsive_score ?? -1;
  const bScore = b.responsive_score ?? -1;
  if (aScore !== bScore) return aScore > bScore ? "a" : "b";
  // 古い方優先（より長く運用されているため信頼度が高い）
  return new Date(a.created_at) <= new Date(b.created_at) ? "a" : "b";
}

// ============================================================
// 重複をコンソールに表示
// ============================================================
function printDuplicates(duplicates: DuplicatePair[]) {
  console.log("\n[dedup-embed] === 重複候補一覧 ===");
  for (const pair of duplicates.slice(0, 20)) {
    console.log(
      `  [${pair.recommendation.toUpperCase()}] similarity=${pair.similarity}`,
    );
    console.log(`    A (保持): ${pair.page_url_a ?? pair.page_id_a}`);
    console.log(`    B (候補): ${pair.page_url_b ?? pair.page_id_b}`);
  }
  if (duplicates.length > 20) {
    console.log(`  ... 他 ${duplicates.length - 20} ペア（レポートを確認してください）`);
  }
}

// ============================================================
// 削除実行（--execute モードのみ）
// ============================================================
async function executeDeletion(
  supabase: ReturnType<typeof createClient>,
  duplicates: DuplicatePair[],
) {
  // recommendation が "delete_b" のペアのみ自動削除
  const toDelete = duplicates.filter((p) => p.recommendation === "delete_b");
  const toReview = duplicates.filter((p) => p.recommendation === "review");

  console.log(`\n[dedup-embed] 削除対象: ${toDelete.length} 件 / 要レビュー: ${toReview.length} 件`);

  let deletedCount = 0;
  let errorCount = 0;

  for (const pair of toDelete) {
    const { error } = await supabase
      .from("pages")
      .delete()
      .eq("page_id", pair.page_id_b);

    if (error) {
      console.error(`[dedup-embed]   削除エラー: ${pair.page_id_b} - ${error.message}`);
      errorCount++;
    } else {
      console.log(`[dedup-embed]   削除: ${pair.page_url_b ?? pair.page_id_b} (similarity=${pair.similarity})`);
      deletedCount++;
    }
  }

  console.log(`\n[dedup-embed] 削除完了: ${deletedCount} 件 / エラー: ${errorCount} 件`);

  if (toReview.length > 0) {
    console.log(
      `[dedup-embed] ⚠️  要レビュー: ${toReview.length} ペアは手動確認後に削除してください（${REPORT_PATH} 参照）`,
    );
  }
}

// ============================================================
// GitHub Actions サマリー用 Markdown 生成
// ============================================================
function buildMarkdownReport(report: ReturnType<typeof Object.assign>): string {
  const lines = [
    `## design-vault Embedding 重複検出レポート`,
    ``,
    `実行日時: ${report.checkedAt}`,
    `モード: **${report.mode}**`,
    `しきい値: ${report.threshold}`,
    ``,
    `| 項目 | 値 |`,
    `|------|-----|`,
    `| 検査ページ数 | ${report.checkedPages.toLocaleString()} |`,
    `| 重複候補ペア数 | ${report.duplicatePairs} |`,
    ``,
  ];

  if (report.pairs && report.pairs.length > 0) {
    lines.push(`### 上位 重複候補`);
    lines.push(``);
    lines.push(`| 類似度 | 推奨アクション | ページ A | ページ B |`);
    lines.push(`|--------|--------------|---------|---------|`);
    for (const pair of report.pairs.slice(0, 10)) {
      lines.push(
        `| ${pair.similarity} | ${pair.recommendation} | ${pair.page_url_a ?? pair.page_id_a} | ${pair.page_url_b ?? pair.page_id_b} |`,
      );
    }
    lines.push(``);
  }

  return lines.join("\n");
}

// ============================================================
// 実行
// ============================================================
main().catch((err) => {
  console.error("[dedup-embed] 予期しないエラー:", err);
  process.exit(1);
});
