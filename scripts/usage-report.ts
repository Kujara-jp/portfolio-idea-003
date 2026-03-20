/**
 * design-vault: MCP ツール利用状況レポートスクリプト
 *
 * ~/.design-vault/usage.jsonl に記録された MCP ツール呼び出しログを読み込み、
 * ツール別・日別・週別の集計を表示する。
 *
 * 実行方法:
 *   npx tsx scripts/usage-report.ts
 *   npx tsx scripts/usage-report.ts --days=30    # 過去 N 日間（デフォルト: 30）
 *   npx tsx scripts/usage-report.ts --month=2026-03  # 特定月のみ
 *
 * ログ形式（~/.design-vault/usage.jsonl の各行）:
 *   {"timestamp":"ISO8601","tool":"search_designs","params_hash":"abc123def456","result_count":5}
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ============================================================
// 設定
// ============================================================

const USAGE_LOG_FILE = path.join(os.homedir(), ".design-vault", "usage.jsonl");

const args = process.argv.slice(2);
const daysArg = args.find((a) => a.startsWith("--days="));
const monthArg = args.find((a) => a.startsWith("--month="));

const DAYS = daysArg ? parseInt(daysArg.split("=")[1], 10) : 30;
const FILTER_MONTH = monthArg ? monthArg.split("=")[1] : null; // 例: "2026-03"

// ============================================================
// 型定義
// ============================================================

interface LogEntry {
  timestamp: string;
  tool: string;
  params_hash: string;
  result_count: number;
}

// ============================================================
// ログ読み込み
// ============================================================

function loadLogs(): LogEntry[] {
  if (!fs.existsSync(USAGE_LOG_FILE)) {
    console.log(`ログファイルが見つかりません: ${USAGE_LOG_FILE}`);
    console.log("MCP ツールを使用するとログが記録されます。");
    return [];
  }

  const raw = fs.readFileSync(USAGE_LOG_FILE, "utf-8");
  const lines = raw.trim().split("\n").filter((l) => l.trim());

  const entries: LogEntry[] = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as LogEntry;
      if (entry.timestamp && entry.tool) {
        entries.push(entry);
      }
    } catch {
      // 壊れた行はスキップ
    }
  }

  return entries;
}

// ============================================================
// フィルタリング
// ============================================================

function filterEntries(entries: LogEntry[]): LogEntry[] {
  if (FILTER_MONTH) {
    return entries.filter((e) => e.timestamp.startsWith(FILTER_MONTH));
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - DAYS);
  return entries.filter((e) => new Date(e.timestamp) >= cutoff);
}

// ============================================================
// 集計
// ============================================================

function summarize(entries: LogEntry[]) {
  if (entries.length === 0) {
    return null;
  }

  // ツール別集計
  const byTool: Record<string, { count: number; totalResults: number }> = {};
  for (const e of entries) {
    if (!byTool[e.tool]) byTool[e.tool] = { count: 0, totalResults: 0 };
    byTool[e.tool].count++;
    byTool[e.tool].totalResults += e.result_count ?? 0;
  }

  // 日別集計
  const byDay: Record<string, number> = {};
  for (const e of entries) {
    const day = e.timestamp.slice(0, 10); // "2026-03-20"
    byDay[day] = (byDay[day] ?? 0) + 1;
  }

  // 週別集計
  const byWeek: Record<string, number> = {};
  for (const e of entries) {
    const date = new Date(e.timestamp);
    // ISO週番号
    const startOfYear = new Date(date.getFullYear(), 0, 1);
    const weekNum = Math.ceil(
      ((date.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7,
    );
    const weekKey = `${date.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
    byWeek[weekKey] = (byWeek[weekKey] ?? 0) + 1;
  }

  // 時間帯別集計（JST = UTC+9）
  const byHour: Record<number, number> = {};
  for (const e of entries) {
    const hourUTC = new Date(e.timestamp).getUTCHours();
    const hourJST = (hourUTC + 9) % 24;
    byHour[hourJST] = (byHour[hourJST] ?? 0) + 1;
  }

  // 最初と最後のログ
  const sorted = [...entries].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const firstAt = sorted[0].timestamp;
  const lastAt = sorted[sorted.length - 1].timestamp;

  return { byTool, byDay, byWeek, byHour, firstAt, lastAt, total: entries.length };
}

// ============================================================
// 表示
// ============================================================

function pad(s: string, n: number): string {
  return s.padEnd(n);
}

function padLeft(s: string | number, n: number): string {
  return String(s).padStart(n);
}

function printReport(entries: LogEntry[], summary: ReturnType<typeof summarize>) {
  const filterLabel = FILTER_MONTH
    ? `月: ${FILTER_MONTH}`
    : `過去 ${DAYS} 日間`;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  design-vault MCP ツール利用状況レポート`);
  console.log(`  対象期間: ${filterLabel}`);
  if (summary) {
    console.log(`  集計期間: ${summary.firstAt.slice(0, 10)} 〜 ${summary.lastAt.slice(0, 10)}`);
  }
  console.log(`${"=".repeat(60)}\n`);

  if (!summary || entries.length === 0) {
    console.log("  ログがありません。MCP ツールを使用するとログが記録されます。\n");
    return;
  }

  // 総計
  console.log(`【総呼び出し数】 ${summary.total} 回\n`);

  // ツール別
  console.log("【ツール別集計】");
  console.log(`  ${pad("ツール名", 20)} ${"呼び出し".padStart(8)} ${"結果件数合計".padStart(12)} ${"平均件数".padStart(8)}`);
  console.log(`  ${"-".repeat(54)}`);

  const toolEntries = Object.entries(summary.byTool).sort((a, b) => b[1].count - a[1].count);
  for (const [tool, stats] of toolEntries) {
    const avg = stats.count > 0 ? (stats.totalResults / stats.count).toFixed(1) : "0";
    console.log(
      `  ${pad(tool, 20)} ${padLeft(stats.count, 8)} ${padLeft(stats.totalResults, 12)} ${padLeft(avg, 8)}`,
    );
  }
  console.log();

  // 週別
  if (Object.keys(summary.byWeek).length > 0) {
    console.log("【週別集計】");
    const weekEntries = Object.entries(summary.byWeek).sort((a, b) => a[0].localeCompare(b[0]));
    for (const [week, count] of weekEntries) {
      const bar = "█".repeat(Math.min(count, 40));
      console.log(`  ${pad(week, 12)} ${padLeft(count, 4)} 回  ${bar}`);
    }
    console.log();
  }

  // 日別（直近14日）
  const dayEntries = Object.entries(summary.byDay)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-14);
  if (dayEntries.length > 0) {
    console.log("【日別集計（直近14日）】");
    const maxCount = Math.max(...dayEntries.map(([, c]) => c));
    for (const [day, count] of dayEntries) {
      const barLen = maxCount > 0 ? Math.round((count / maxCount) * 30) : 0;
      const bar = "█".repeat(barLen);
      console.log(`  ${day}  ${padLeft(count, 4)} 回  ${bar}`);
    }
    console.log();
  }

  // 時間帯別（JST）
  console.log("【時間帯別集計（JST）】");
  for (let h = 0; h < 24; h += 2) {
    const c1 = summary.byHour[h] ?? 0;
    const c2 = summary.byHour[h + 1] ?? 0;
    const total2 = c1 + c2;
    const bar = "█".repeat(Math.min(total2, 30));
    const label = `${String(h).padStart(2, "0")}:00-${String(h + 2).padStart(2, "0")}:00`;
    console.log(`  ${label}  ${padLeft(total2, 4)} 回  ${bar}`);
  }
  console.log();

  // GitHub Actions サマリー出力
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    const lines: string[] = [
      `## MCP ツール利用状況レポート（${filterLabel}）`,
      "",
      `**総呼び出し数**: ${summary.total} 回`,
      `**集計期間**: ${summary.firstAt.slice(0, 10)} 〜 ${summary.lastAt.slice(0, 10)}`,
      "",
      "### ツール別集計",
      "",
      "| ツール | 呼び出し回数 | 結果件数合計 | 平均件数 |",
      "|--------|------------|------------|--------|",
    ];
    for (const [tool, stats] of toolEntries) {
      const avg = stats.count > 0 ? (stats.totalResults / stats.count).toFixed(1) : "0";
      lines.push(`| ${tool} | ${stats.count} | ${stats.totalResults} | ${avg} |`);
    }
    lines.push("");

    if (dayEntries.length > 0) {
      lines.push("### 日別集計（直近14日）");
      lines.push("");
      for (const [day, count] of dayEntries) {
        lines.push(`- ${day}: ${count} 回`);
      }
      lines.push("");
    }

    fs.appendFileSync(summaryFile, lines.join("\n") + "\n");
  }
}

// ============================================================
// メイン
// ============================================================

const allEntries = loadLogs();
const filtered = filterEntries(allEntries);
const summary = summarize(filtered);

console.log(`ログファイル: ${USAGE_LOG_FILE}`);
console.log(`全ログ件数: ${allEntries.length} 件 / 対象: ${filtered.length} 件`);

printReport(filtered, summary);

if (allEntries.length > 0 && filtered.length === 0) {
  console.log(`ヒント: ログはあります（全${allEntries.length}件）が、指定期間内にはありません。`);
  console.log(`       --days=365 を付けて全期間を確認してみてください。\n`);
}
