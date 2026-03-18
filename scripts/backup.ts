/**
 * design-vault: Supabase データバックアップスクリプト
 *
 * Supabase の sites / pages テーブルを JSON 形式でエクスポートし、
 * ローカルファイルとして出力する。
 * GitHub Actions から実行され、Artifacts として保存（30日間保持）。
 *
 * 実行方法:
 *   npx tsx scripts/backup.ts
 *   npx tsx scripts/backup.ts --tables=sites,pages
 *   npx tsx scripts/backup.ts --output=./backup
 *
 * GitHub Actions 環境変数:
 *   SUPABASE_URL            Supabase プロジェクト URL
 *   SUPABASE_SERVICE_ROLE_KEY  サービスロールキー（全テーブル読み取り権限）
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

// ============================================================
// 設定
// ============================================================
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!;

// ページあたり取得件数（Supabase REST API の上限は 1000 件）
const PAGE_SIZE = 1000;

const args = process.argv.slice(2);
const tablesArg = args.find((a) => a.startsWith("--tables="));
const outputArg = args.find((a) => a.startsWith("--output="));

// バックアップ対象テーブル（page_sections は pages に付随するため別途取得）
const DEFAULT_TABLES = ["sites", "pages", "page_sections"];
const TARGET_TABLES = tablesArg
  ? tablesArg.split("=")[1].split(",")
  : DEFAULT_TABLES;
const OUTPUT_DIR = outputArg ? outputArg.split("=")[1] : "./backup";

// ============================================================
// 型定義
// ============================================================
interface BackupStats {
  table: string;
  rowCount: number;
  filePath: string;
  exportedAt: string;
}

// ============================================================
// メイン処理
// ============================================================
async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("[backup] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です");
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const exportedAt = new Date().toISOString();
  const dateStr = exportedAt.slice(0, 10).replace(/-/g, "");

  // 出力ディレクトリを作成
  mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log(`[backup] 開始 tables=${TARGET_TABLES.join(",")} output=${OUTPUT_DIR}`);

  const stats: BackupStats[] = [];

  for (const table of TARGET_TABLES) {
    try {
      const result = await exportTable(supabase, table, OUTPUT_DIR, dateStr, exportedAt);
      stats.push(result);
    } catch (err) {
      console.error(`[backup] ${table} のエクスポート失敗:`, err);
      // 1テーブルの失敗で全体を止めない
    }
  }

  // サマリー JSON を出力
  const summaryPath = join(OUTPUT_DIR, `backup_summary_${dateStr}.json`);
  const summary = {
    exportedAt,
    tables: stats,
    totalRows: stats.reduce((sum, s) => sum + s.rowCount, 0),
  };
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf8");
  console.log(`\n[backup] サマリー: ${summaryPath}`);

  // GitHub Actions のジョブサマリーに出力（CI 環境のみ）
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    const lines = [
      `## Supabase バックアップ完了`,
      ``,
      `実行日時: ${exportedAt}`,
      ``,
      `| テーブル | レコード数 | ファイル |`,
      `|---------|-----------|---------|`,
      ...stats.map((s) => `| ${s.table} | ${s.rowCount.toLocaleString()} | \`${s.filePath}\` |`),
      ``,
      `**合計: ${summary.totalRows.toLocaleString()} レコード**`,
    ];
    writeFileSync(summaryFile, lines.join("\n"), { flag: "a" });
  }

  console.log("\n[backup] 完了");
  for (const s of stats) {
    console.log(`  ${s.table}: ${s.rowCount.toLocaleString()} 件 → ${s.filePath}`);
  }
}

// ============================================================
// テーブル全件エクスポート（ページネーション対応）
// ============================================================
async function exportTable(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  table: string,
  outputDir: string,
  dateStr: string,
  exportedAt: string,
): Promise<BackupStats> {
  console.log(`\n[backup] ${table} エクスポート中...`);

  const allRows: Record<string, unknown>[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .range(offset, offset + PAGE_SIZE - 1)
      .order("created_at", { ascending: true });

    if (error) {
      throw new Error(`${table} 取得エラー (offset=${offset}): ${error.message}`);
    }

    if (!data || data.length === 0) break;

    allRows.push(...(data as Record<string, unknown>[]));
    console.log(`[backup]   ${table}: ${allRows.length} 件取得済み...`);

    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  // JSON 形式で書き出し（embedding ベクトルは容量が大きいため除外）
  const sanitizedRows = allRows.map((row) => {
    const { embedding, ...rest } = row as { embedding?: unknown } & Record<string, unknown>;
    void embedding; // 使わない変数の lint 警告抑制
    return rest;
  });

  const filePath = join(outputDir, `${table}_${dateStr}.json`);
  const payload = {
    table,
    exportedAt,
    rowCount: sanitizedRows.length,
    rows: sanitizedRows,
  };

  writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");

  return {
    table,
    rowCount: sanitizedRows.length,
    filePath,
    exportedAt,
  };
}

// ============================================================
// 実行
// ============================================================
main().catch((err) => {
  console.error("[backup] 予期しないエラー:", err);
  process.exit(1);
});
