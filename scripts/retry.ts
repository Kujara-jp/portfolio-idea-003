/**
 * design-vault: ブロックサイト再試行スクリプト
 * is_blocked=true のサイトをリセットして collect_queue に再投入する
 *
 * 実行方法:
 *   npx tsx scripts/retry.ts
 *   npx tsx scripts/retry.ts --limit=10
 *
 * 再投入後、collect → score パイプラインが自動で再処理する
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!;

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const BATCH_LIMIT = limitArg ? parseInt(limitArg.split("=")[1]) : 50;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 再試行しても無駄なサイト（強力なボット対策・SNS等）
const SKIP_DOMAINS = [
  "reddit.com",
  "oracle.com",
  "salesforce.com",
  "capterra.jp",
];

async function main() {
  console.log(`[retry] 開始（最大${BATCH_LIMIT}件）`);

  const { data: blocked, error } = await supabase
    .from("sites")
    .select("site_id, url")
    .eq("is_blocked", true)
    .limit(BATCH_LIMIT);

  if (error) {
    console.error("[retry] サイト取得エラー:", error.message);
    process.exit(1);
  }

  if (!blocked || blocked.length === 0) {
    console.log("[retry] ブロックサイトなし。終了します。");
    return;
  }

  // スキップ対象を除外
  const targets = blocked.filter((s) => {
    try {
      const hostname = new URL(s.url).hostname.toLowerCase();
      return !SKIP_DOMAINS.some((d) => hostname.includes(d));
    } catch {
      return false;
    }
  });

  const skipped = blocked.length - targets.length;
  console.log(
    `[retry] ${blocked.length}件中 ${targets.length}件を再試行（${skipped}件スキップ）`,
  );

  if (targets.length === 0) {
    console.log("[retry] 再試行対象なし。終了します。");
    return;
  }

  let successCount = 0;

  for (const site of targets) {
    try {
      // 1. sites の is_blocked をリセット
      await supabase
        .from("sites")
        .update({ is_blocked: false, quality_score: null })
        .eq("site_id", site.site_id);

      // 2. pages の is_blocked をリセット
      await supabase
        .from("pages")
        .update({
          is_blocked: false,
          responsive_score: null,
          needs_review: true,
        })
        .eq("site_id", site.site_id);

      // 3. collect_queue に再投入（既に pending がなければ）
      const { data: existing } = await supabase
        .from("collect_queue")
        .select("queue_id")
        .eq("url", site.url)
        .eq("status", "pending")
        .limit(1);

      if (!existing || existing.length === 0) {
        await supabase.from("collect_queue").insert({
          url: site.url,
          status: "pending",
          priority: 5,
        });
      }

      successCount++;
      console.log(`[retry] リセット: ${site.url}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[retry] エラー: ${site.url} - ${message}`);
    }
  }

  console.log(`\n[retry] 完了（${successCount}件リセット・再投入）`);
  console.log("[retry] 次回の collect → score 実行時に再処理されます。");
}

main().catch((err) => {
  console.error("[retry] 予期しないエラー:", err);
  process.exit(1);
});
