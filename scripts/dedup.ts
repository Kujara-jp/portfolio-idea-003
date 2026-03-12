/**
 * design-vault: 重複検出・クリーンアップスクリプト
 * URL正規化ベースで sites / pages / collect_queue の重複を検出・解消する
 *
 * 実行方法:
 *   npx tsx scripts/dedup.ts --dry-run           # レポートのみ
 *   npx tsx scripts/dedup.ts                     # 実行
 *   npx tsx scripts/dedup.ts --section=sites     # サイト重複のみ
 *   npx tsx scripts/dedup.ts --section=pages     # ページ重複のみ
 *   npx tsx scripts/dedup.ts --section=queue     # キュー掃除のみ
 */

import { createClient } from "@supabase/supabase-js";
import { normalizeForDedup } from "./lib/normalize";

// ============================================================
// 設定
// ============================================================
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const sectionArg = args.find((a) => a.startsWith("--section="));
const SECTION = sectionArg ? sectionArg.split("=")[1] : "all";

// ============================================================
// 型定義
// ============================================================
interface SiteRow {
  site_id: string;
  url: string;
  is_blocked: boolean | null;
  quality_score: number | null;
  created_at: string;
}

interface PageRow {
  page_id: string;
  site_id: string;
  page_url: string;
  screenshot_pc: string | null;
  responsive_score: number | null;
  created_at: string;
}

interface QueueRow {
  queue_id: string;
  url: string;
  status: string;
  created_at: string;
  completed_at: string | null;
}

// ============================================================
// メイン処理
// ============================================================
async function main() {
  console.log(
    `[dedup] 開始 (mode=${DRY_RUN ? "dry-run" : "execute"}, section=${SECTION})`,
  );

  if (SECTION === "all" || SECTION === "sites") {
    await dedupSites();
  }
  if (SECTION === "all" || SECTION === "pages") {
    await dedupPages();
  }
  if (SECTION === "all" || SECTION === "queue") {
    await cleanQueue();
  }

  console.log("\n[dedup] 完了");
}

// ============================================================
// Phase 1: サイト重複検出・マージ
// ============================================================
async function dedupSites() {
  console.log("\n[dedup] === サイト重複検出 ===");

  // 全サイトを取得
  const { data: sites, error } = await supabase
    .from("sites")
    .select("site_id, url, is_blocked, quality_score, created_at")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[dedup] sites取得エラー:", error.message);
    return;
  }
  if (!sites || sites.length === 0) {
    console.log("[dedup] サイトなし");
    return;
  }

  // normalizeForDedup でグルーピング
  const groups = new Map<string, SiteRow[]>();
  for (const site of sites as SiteRow[]) {
    const key = normalizeForDedup(site.url);
    const group = groups.get(key) ?? [];
    group.push(site);
    groups.set(key, group);
  }

  // 2件以上のグループのみ対象
  const dupeGroups = Array.from(groups.entries()).filter(([, g]) => g.length > 1);

  if (dupeGroups.length === 0) {
    console.log("[dedup] サイト重複なし");
    return;
  }

  const totalDupes = dupeGroups.reduce((sum, [, g]) => sum + g.length, 0);
  console.log(
    `[dedup] 重複グループ: ${dupeGroups.length}件（対象サイト: ${totalDupes}件）`,
  );

  for (const [normKey, group] of dupeGroups) {
    console.log(
      `[dedup]   ${normKey}: ${group.length}件 (${group.map((s) => s.url).join(", ")})`,
    );

    if (DRY_RUN) continue;

    // カノニカルサイトを選定
    const canonical = selectCanonicalSite(group);
    const dupes = group.filter((s) => s.site_id !== canonical.site_id);

    // 各ページ数を取得（重み付け選定の参考ログ）
    console.log(`[dedup]   → canonical: ${canonical.url} (id=${canonical.site_id})`);

    for (const dupe of dupes) {
      await mergeSite(canonical, dupe);
    }
  }
}

/**
 * カノニカルサイトを選定
 * 優先順: is_blocked=false > quality_score高い > ページ数多い > created_at古い
 * （ページ数はDB再クエリが重いので created_at で代替）
 */
function selectCanonicalSite(group: SiteRow[]): SiteRow {
  return group.sort((a, b) => {
    // is_blocked=false を優先
    const aBlocked = a.is_blocked === true ? 1 : 0;
    const bBlocked = b.is_blocked === true ? 1 : 0;
    if (aBlocked !== bBlocked) return aBlocked - bBlocked;

    // quality_score が高い方を優先（NULLは最低）
    const aScore = a.quality_score ?? -1;
    const bScore = b.quality_score ?? -1;
    if (aScore !== bScore) return bScore - aScore;

    // created_at が古い方を優先
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  })[0];
}

/**
 * 重複サイトを canonical にマージ
 */
async function mergeSite(canonical: SiteRow, dupe: SiteRow) {
  console.log(
    `[dedup]   マージ: ${dupe.url} → ${canonical.url}`,
  );

  // 1. 重複サイトのページを取得
  const { data: dupePages } = await supabase
    .from("pages")
    .select("page_id, page_url")
    .eq("site_id", dupe.site_id);

  if (dupePages && dupePages.length > 0) {
    for (const page of dupePages) {
      // site_id を更新してページを移動
      const { error: moveError } = await supabase
        .from("pages")
        .update({ site_id: canonical.site_id })
        .eq("page_id", page.page_id);

      if (moveError) {
        // UNIQUE制約違反（site_id, page_url の重複）→ 重複ページは削除
        if (moveError.message.includes("unique") || moveError.message.includes("duplicate")) {
          console.log(
            `[dedup]     ページ衝突 → 削除: ${page.page_url}`,
          );
          await supabase.from("pages").delete().eq("page_id", page.page_id);
        } else {
          console.error(
            `[dedup]     ページ移動エラー: ${page.page_url} - ${moveError.message}`,
          );
        }
      }
    }
  }

  // 2. collect_queue の site_id を更新
  await supabase
    .from("collect_queue")
    .update({ site_id: canonical.site_id })
    .eq("site_id", dupe.site_id);

  // 3. 重複サイトを削除（ページは移動済み）
  const { error: deleteError } = await supabase
    .from("sites")
    .delete()
    .eq("site_id", dupe.site_id);

  if (deleteError) {
    console.error(
      `[dedup]     サイト削除エラー: ${dupe.url} - ${deleteError.message}`,
    );
  } else {
    console.log(`[dedup]     削除完了: ${dupe.url}`);
  }
}

// ============================================================
// Phase 2: ページ重複検出
// ============================================================
async function dedupPages() {
  console.log("\n[dedup] === ページ重複検出 ===");

  // 全ページを取得
  const { data: pages, error } = await supabase
    .from("pages")
    .select(
      "page_id, site_id, page_url, screenshot_pc, responsive_score, created_at",
    )
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[dedup] pages取得エラー:", error.message);
    return;
  }
  if (!pages || pages.length === 0) {
    console.log("[dedup] ページなし");
    return;
  }

  // 同一サイト内で normalizeForDedup(page_url) が同じページをグルーピング
  const groups = new Map<string, PageRow[]>();
  for (const page of pages as PageRow[]) {
    const key = `${page.site_id}::${normalizeForDedup(page.page_url)}`;
    const group = groups.get(key) ?? [];
    group.push(page);
    groups.set(key, group);
  }

  const dupeGroups = Array.from(groups.entries()).filter(([, g]) => g.length > 1);

  if (dupeGroups.length === 0) {
    console.log("[dedup] ページ重複なし");
    return;
  }

  console.log(`[dedup] 重複ページグループ: ${dupeGroups.length}件`);

  for (const [key, group] of dupeGroups) {
    console.log(
      `[dedup]   ${key}: ${group.length}件`,
    );

    if (DRY_RUN) continue;

    // カノニカルページを選定
    const canonical = selectCanonicalPage(group);
    const dupes = group.filter((p) => p.page_id !== canonical.page_id);

    console.log(`[dedup]   → canonical: ${canonical.page_url} (id=${canonical.page_id})`);

    for (const dupe of dupes) {
      const { error: deleteError } = await supabase
        .from("pages")
        .delete()
        .eq("page_id", dupe.page_id);

      if (deleteError) {
        console.error(
          `[dedup]     ページ削除エラー: ${dupe.page_url} - ${deleteError.message}`,
        );
      } else {
        console.log(`[dedup]     削除: ${dupe.page_url}`);
      }
    }
  }
}

/**
 * カノニカルページを選定
 * 優先順: screenshot_pc有り > quality_score有り > created_at古い
 */
function selectCanonicalPage(group: PageRow[]): PageRow {
  return group.sort((a, b) => {
    // スクリーンショット有り優先
    const aHasScreenshot = a.screenshot_pc ? 1 : 0;
    const bHasScreenshot = b.screenshot_pc ? 1 : 0;
    if (aHasScreenshot !== bHasScreenshot) return bHasScreenshot - aHasScreenshot;

    // responsive_score 有り優先
    const aScore = a.responsive_score ?? -1;
    const bScore = b.responsive_score ?? -1;
    if (aScore !== bScore) return bScore - aScore;

    // created_at 古い方を優先
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  })[0];
}

// ============================================================
// Phase 3: キュー掃除
// ============================================================
async function cleanQueue() {
  console.log("\n[dedup] === キュー掃除 ===");

  // 1. done レコードを削除
  const { count: doneCount } = await supabase
    .from("collect_queue")
    .select("*", { count: "exact", head: true })
    .eq("status", "done");

  console.log(`[dedup] done: ${doneCount ?? 0}件削除${DRY_RUN ? "予定" : ""}`);

  if (!DRY_RUN && (doneCount ?? 0) > 0) {
    const { error } = await supabase
      .from("collect_queue")
      .delete()
      .eq("status", "done");
    if (error) console.error("[dedup] done削除エラー:", error.message);
  }

  // 2. error で7日以上経過したレコードを削除
  const sevenDaysAgo = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { count: staleErrorCount } = await supabase
    .from("collect_queue")
    .select("*", { count: "exact", head: true })
    .eq("status", "error")
    .lt("completed_at", sevenDaysAgo);

  console.log(
    `[dedup] stale error: ${staleErrorCount ?? 0}件削除${DRY_RUN ? "予定" : ""}`,
  );

  if (!DRY_RUN && (staleErrorCount ?? 0) > 0) {
    const { error } = await supabase
      .from("collect_queue")
      .delete()
      .eq("status", "error")
      .lt("completed_at", sevenDaysAgo);
    if (error) console.error("[dedup] stale error削除エラー:", error.message);
  }

  // 3. processing で24時間以上経過したレコードをリセット
  const oneDayAgo = new Date(
    Date.now() - 24 * 60 * 60 * 1000,
  ).toISOString();

  const { count: staleProcessingCount } = await supabase
    .from("collect_queue")
    .select("*", { count: "exact", head: true })
    .eq("status", "processing")
    .lt("started_at", oneDayAgo);

  console.log(
    `[dedup] stale processing: ${staleProcessingCount ?? 0}件リセット${DRY_RUN ? "予定" : ""}`,
  );

  if (!DRY_RUN && (staleProcessingCount ?? 0) > 0) {
    const { error } = await supabase
      .from("collect_queue")
      .update({ status: "pending", started_at: null })
      .eq("status", "processing")
      .lt("started_at", oneDayAgo);
    if (error)
      console.error("[dedup] stale processing リセットエラー:", error.message);
  }

  // 4. pending 内の重複URL（正規化後同一）を1件に絞る
  await dedupPendingQueue();
}

/**
 * pending キュー内の重複URLを検出・削除
 */
async function dedupPendingQueue() {
  const { data: pendingItems, error } = await supabase
    .from("collect_queue")
    .select("queue_id, url, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[dedup] pending取得エラー:", error.message);
    return;
  }
  if (!pendingItems || pendingItems.length === 0) {
    console.log("[dedup] pending重複: 0件");
    return;
  }

  // normalizeForDedup でグルーピング
  const groups = new Map<string, QueueRow[]>();
  for (const item of pendingItems as QueueRow[]) {
    const key = normalizeForDedup(item.url);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }

  const dupeGroups = Array.from(groups.entries()).filter(([, g]) => g.length > 1);
  const dupeCount = dupeGroups.reduce(
    (sum, [, g]) => sum + (g.length - 1),
    0,
  );

  console.log(
    `[dedup] pending重複: ${dupeCount}件削除${DRY_RUN ? "予定" : ""}`,
  );

  if (DRY_RUN) return;

  for (const [, group] of dupeGroups) {
    // 最初の1件（最古）を残し、残りを削除
    const toDelete = group.slice(1);
    for (const item of toDelete) {
      await supabase
        .from("collect_queue")
        .delete()
        .eq("queue_id", item.queue_id);
    }
  }
}

// ============================================================
// 実行
// ============================================================
main().catch((err) => {
  console.error("[dedup] 予期しないエラー:", err);
  process.exit(1);
});
