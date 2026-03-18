/**
 * design-vault: コスト監視スクリプト
 *
 * Supabase のデータ統計（ページ数・スコア分布・Embedding 数）から
 * 月次の API 使用量とコストを推計してレポートする。
 * GitHub Actions から実行し、ジョブサマリーに記録する。
 * コストが予算の 80% を超えた場合はワークフローを警告終了させる。
 *
 * 実行方法:
 *   npx tsx scripts/cost-check.ts
 *   npx tsx scripts/cost-check.ts --budget=60   # 月予算 $60 で上書き
 *
 * 環境変数:
 *   SUPABASE_URL               Supabase プロジェクト URL
 *   SUPABASE_SERVICE_ROLE_KEY  サービスロールキー
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { writeFileSync } from "fs";

// ============================================================
// 設定
// ============================================================
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!;

const args = process.argv.slice(2);
const budgetArg = args.find((a) => a.startsWith("--budget="));

// 月予算 ($) — ROADMAP.md のコスト目安に準拠
const MONTHLY_BUDGET_USD = budgetArg ? parseFloat(budgetArg.split("=")[1]) : 55;
// 警告しきい値 (予算の 80%)
const WARN_THRESHOLD = MONTHLY_BUDGET_USD * 0.8;
// アラートしきい値 (予算の 100%)
const ALERT_THRESHOLD = MONTHLY_BUDGET_USD;

// API コスト定数（Claude Haiku Batch API + OpenAI embedding）
const COST = {
  // Claude Haiku 3.5 Batch API 単価 ($/1000 tokens)
  haikuInputPer1k: 0.0004,  // $0.40 / 1M tokens
  haikuOutputPer1k: 0.002,  // $2.00 / 1M tokens
  // 1ページあたりの平均トークン消費推計
  scoreTokensPerPage: 500,
  tagTokensPerPage: 800,
  sectionsTokensPerPage: 400,
  industryTokensPerSite: 300,
  // OpenAI text-embedding-3-small 単価 ($/1M tokens)
  embeddingPer1M: 0.02,
  // 1ページあたりの embedding トークン推計
  embeddingTokensPerPage: 200,
};

// ============================================================
// 型定義
// ============================================================
interface DataStats {
  totalSites: number;
  totalPages: number;
  scoredPages: number;
  taggedPages: number;
  sectionsDetectedPages: number;
  embeddedPages: number;
  blockedSites: number;
  needsReviewPages: number;
  qualityDistribution: Record<string, number>;
}

interface CostEstimate {
  scoreCost: number;
  tagCost: number;
  sectionsCost: number;
  industryCost: number;
  embeddingCost: number;
  totalMonthlyEstimate: number;
  pagesPerMonth: number;
}

// ============================================================
// メイン処理
// ============================================================
async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("[cost-check] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です");
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const checkedAt = new Date().toISOString();

  console.log("[cost-check] データ統計を取得中...");

  // データ統計を取得
  const stats = await fetchDataStats(supabase);
  // コスト推計
  const costEstimate = estimateMonthlyCost(stats);

  // レポートを表示
  printReport(stats, costEstimate, checkedAt);

  // GitHub Actions のジョブサマリーに出力
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    const summaryContent = buildMarkdownReport(stats, costEstimate, checkedAt);
    writeFileSync(summaryFile, summaryContent, { flag: "a" });
  }

  // 予算超過チェック
  if (costEstimate.totalMonthlyEstimate >= ALERT_THRESHOLD) {
    console.error(
      `\n[cost-check] ⚠️  警告: 推計月次コスト $${costEstimate.totalMonthlyEstimate.toFixed(2)} が予算 $${MONTHLY_BUDGET_USD} を超えています`,
    );
    // GitHub Actions では exit code 1 でワークフローを失敗させ、通知を送る
    process.exit(1);
  } else if (costEstimate.totalMonthlyEstimate >= WARN_THRESHOLD) {
    console.warn(
      `\n[cost-check] 注意: 推計月次コスト $${costEstimate.totalMonthlyEstimate.toFixed(2)} が予算の 80% ($${WARN_THRESHOLD.toFixed(2)}) を超えています`,
    );
    // 警告は記録するが終了コードは 0 のまま
  } else {
    console.log(
      `\n[cost-check] OK: 推計月次コスト $${costEstimate.totalMonthlyEstimate.toFixed(2)} / 予算 $${MONTHLY_BUDGET_USD}`,
    );
  }
}

// ============================================================
// データ統計取得
// ============================================================
async function fetchDataStats(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
): Promise<DataStats> {
  // サイト総数・ブロック数
  const { count: totalSites } = await supabase
    .from("sites")
    .select("*", { count: "exact", head: true })
    .is("deleted_at", null);

  const { count: blockedSites } = await supabase
    .from("sites")
    .select("*", { count: "exact", head: true })
    .eq("is_blocked", true)
    .is("deleted_at", null);

  // ページ総数
  const { count: totalPages } = await supabase
    .from("pages")
    .select("*", { count: "exact", head: true })
    .is("deleted_at", null);

  // スコア済みページ数（quality_score が入っているサイトのページ）
  const { count: scoredSites } = await supabase
    .from("sites")
    .select("*", { count: "exact", head: true })
    .not("quality_score", "is", null)
    .is("deleted_at", null);

  // タグ付け済みページ数（design_tone が入っているページ）
  const { count: taggedPages } = await supabase
    .from("pages")
    .select("*", { count: "exact", head: true })
    .not("design_tone", "is", null)
    .is("deleted_at", null);

  // セクション検出済みページ数
  const { count: sectionsDetectedPages } = await supabase
    .from("pages")
    .select("*", { count: "exact", head: true })
    .eq("sections_detected", true)
    .is("deleted_at", null);

  // embedding 生成済みページ数
  const { count: embeddedPages } = await supabase
    .from("pages")
    .select("*", { count: "exact", head: true })
    .not("embedding", "is", null)
    .is("deleted_at", null);

  // レビュー必要ページ数
  const { count: needsReviewPages } = await supabase
    .from("pages")
    .select("*", { count: "exact", head: true })
    .eq("needs_review", true)
    .is("deleted_at", null);

  // quality_score 分布（サイト単位）
  const { data: qualityData } = await supabase
    .from("sites")
    .select("quality_score")
    .not("quality_score", "is", null)
    .is("deleted_at", null);

  const qualityDistribution: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  for (const row of qualityData ?? []) {
    const score = String(row.quality_score);
    if (score in qualityDistribution) {
      qualityDistribution[score]++;
    }
  }

  return {
    totalSites: totalSites ?? 0,
    totalPages: totalPages ?? 0,
    scoredPages: scoredSites ?? 0,
    taggedPages: taggedPages ?? 0,
    sectionsDetectedPages: sectionsDetectedPages ?? 0,
    embeddedPages: embeddedPages ?? 0,
    blockedSites: blockedSites ?? 0,
    needsReviewPages: needsReviewPages ?? 0,
    qualityDistribution,
  };
}

// ============================================================
// 月次コスト推計
// ============================================================
function estimateMonthlyCost(stats: DataStats): CostEstimate {
  // 月間新規ページ数の推計: 1日4回実行 × 80件 × 30日 ÷ 12 ≈ 800件/月
  // ただし実際の収集数は少ないため、過去データから保守的に推計
  // 現在の総ページ数から月次増分を単純推計（正確な数値は Supabase Dashboard で確認）
  const pagesPerMonth = Math.max(Math.round(stats.totalPages / 3), 200);

  // score.ts: score + tag + sections + industry が1ページ処理
  const scoreInputTokens = (COST.scoreTokensPerPage * pagesPerMonth) / 1000;
  const scoreOutputTokens = scoreInputTokens * 0.1;
  const scoreCost =
    scoreInputTokens * COST.haikuInputPer1k +
    scoreOutputTokens * COST.haikuOutputPer1k;

  const tagInputTokens = (COST.tagTokensPerPage * pagesPerMonth) / 1000;
  const tagOutputTokens = tagInputTokens * 0.15;
  const tagCost =
    tagInputTokens * COST.haikuInputPer1k +
    tagOutputTokens * COST.haikuOutputPer1k;

  const sectionsInputTokens = (COST.sectionsTokensPerPage * pagesPerMonth) / 1000;
  const sectionsOutputTokens = sectionsInputTokens * 0.1;
  const sectionsCost =
    sectionsInputTokens * COST.haikuInputPer1k +
    sectionsOutputTokens * COST.haikuOutputPer1k;

  const industrySites = Math.round(pagesPerMonth * 0.3); // 新規サイトはページの約30%
  const industryInputTokens = (COST.industryTokensPerSite * industrySites) / 1000;
  const industryOutputTokens = industryInputTokens * 0.1;
  const industryCost =
    industryInputTokens * COST.haikuInputPer1k +
    industryOutputTokens * COST.haikuOutputPer1k;

  // embedding: text-embedding-3-small
  const embeddingTokens = COST.embeddingTokensPerPage * pagesPerMonth;
  const embeddingCost = (embeddingTokens / 1_000_000) * COST.embeddingPer1M;

  const totalMonthlyEstimate =
    scoreCost + tagCost + sectionsCost + industryCost + embeddingCost;

  return {
    scoreCost,
    tagCost,
    sectionsCost,
    industryCost,
    embeddingCost,
    totalMonthlyEstimate,
    pagesPerMonth,
  };
}

// ============================================================
// レポート出力（コンソール）
// ============================================================
function printReport(
  stats: DataStats,
  cost: CostEstimate,
  checkedAt: string,
) {
  console.log("\n============================================================");
  console.log("design-vault コスト監視レポート");
  console.log(`実行日時: ${checkedAt}`);
  console.log("============================================================");
  console.log("\n[ データ統計 ]");
  console.log(`  総サイト数:          ${stats.totalSites.toLocaleString()}`);
  console.log(`  総ページ数:          ${stats.totalPages.toLocaleString()}`);
  console.log(`  スコア済みサイト:    ${stats.scoredPages.toLocaleString()}`);
  console.log(`  タグ付け済みページ:  ${stats.taggedPages.toLocaleString()}`);
  console.log(`  セクション検出済み:  ${stats.sectionsDetectedPages.toLocaleString()}`);
  console.log(`  Embedding 生成済み:  ${stats.embeddedPages.toLocaleString()}`);
  console.log(`  ブロック済みサイト:  ${stats.blockedSites.toLocaleString()}`);
  console.log(`  要レビューページ:    ${stats.needsReviewPages.toLocaleString()}`);
  console.log("\n[ Quality Score 分布 ]");
  for (const [score, count] of Object.entries(stats.qualityDistribution)) {
    const bar = "█".repeat(Math.round(count / Math.max(stats.scoredPages, 1) * 20));
    console.log(`  Q${score}: ${bar} ${count}`);
  }
  console.log("\n[ 月次コスト推計 ]");
  console.log(`  推計月間新規ページ数: ${cost.pagesPerMonth.toLocaleString()}`);
  console.log(`  score.ts:      $${cost.scoreCost.toFixed(2)}`);
  console.log(`  tag.ts:        $${cost.tagCost.toFixed(2)}`);
  console.log(`  sections.ts:   $${cost.sectionsCost.toFixed(2)}`);
  console.log(`  industry.ts:   $${cost.industryCost.toFixed(2)}`);
  console.log(`  embed.ts:      $${cost.embeddingCost.toFixed(4)}`);
  console.log(`  -------------------------------------------`);
  console.log(`  推計月次合計:  $${cost.totalMonthlyEstimate.toFixed(2)}`);
  console.log(`  予算:          $${MONTHLY_BUDGET_USD}`);
  console.log(`  使用率:        ${((cost.totalMonthlyEstimate / MONTHLY_BUDGET_USD) * 100).toFixed(1)}%`);
}

// ============================================================
// GitHub Actions サマリー用 Markdown 生成
// ============================================================
function buildMarkdownReport(
  stats: DataStats,
  cost: CostEstimate,
  checkedAt: string,
): string {
  const usagePercent = ((cost.totalMonthlyEstimate / MONTHLY_BUDGET_USD) * 100).toFixed(1);
  const status =
    cost.totalMonthlyEstimate >= ALERT_THRESHOLD
      ? "OVER_BUDGET"
      : cost.totalMonthlyEstimate >= WARN_THRESHOLD
        ? "WARNING"
        : "OK";

  const lines = [
    `## design-vault コスト監視レポート`,
    ``,
    `実行日時: ${checkedAt}`,
    `ステータス: **${status}**`,
    ``,
    `### データ統計`,
    ``,
    `| 項目 | 値 |`,
    `|------|-----|`,
    `| 総サイト数 | ${stats.totalSites.toLocaleString()} |`,
    `| 総ページ数 | ${stats.totalPages.toLocaleString()} |`,
    `| スコア済みサイト | ${stats.scoredPages.toLocaleString()} |`,
    `| タグ付け済みページ | ${stats.taggedPages.toLocaleString()} |`,
    `| セクション検出済み | ${stats.sectionsDetectedPages.toLocaleString()} |`,
    `| Embedding 生成済み | ${stats.embeddedPages.toLocaleString()} |`,
    `| ブロック済みサイト | ${stats.blockedSites.toLocaleString()} |`,
    `| 要レビューページ | ${stats.needsReviewPages.toLocaleString()} |`,
    ``,
    `### 月次コスト推計`,
    ``,
    `| 項目 | 推計コスト |`,
    `|------|-----------|`,
    `| score.ts | $${cost.scoreCost.toFixed(2)} |`,
    `| tag.ts | $${cost.tagCost.toFixed(2)} |`,
    `| sections.ts | $${cost.sectionsCost.toFixed(2)} |`,
    `| industry.ts | $${cost.industryCost.toFixed(2)} |`,
    `| embed.ts | $${cost.embeddingCost.toFixed(4)} |`,
    `| **月次合計（推計）** | **$${cost.totalMonthlyEstimate.toFixed(2)}** |`,
    `| 月予算 | $${MONTHLY_BUDGET_USD} |`,
    `| 使用率 | ${usagePercent}% |`,
    ``,
    `> ※ コストは Supabase の統計データから推計した値です。実際の請求は Anthropic / OpenAI Dashboard で確認してください。`,
    ``,
  ];

  return lines.join("\n");
}

// ============================================================
// 実行
// ============================================================
main().catch((err) => {
  console.error("[cost-check] 予期しないエラー:", err);
  process.exit(1);
});
