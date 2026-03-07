/**
 * design-vault: Web収集スクリプト
 * collect_queueからpendingのURLを取得し、スクリーンショットを撮影してSupabaseに保存する
 *
 * 実行方法:
 *   npx ts-node scripts/collect.ts
 *   npx ts-node scripts/collect.ts --limit=5
 */

import { chromium, type Browser } from "playwright";
import { createClient } from "@supabase/supabase-js";

// ============================================================
// 設定
// ============================================================
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;
const STORAGE_BUCKET = "screenshots";

const VIEWPORT_PC = { width: 1280, height: 800 };
const VIEWPORT_SP = { width: 375, height: 812 };

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const BATCH_LIMIT = limitArg ? parseInt(limitArg.split("=")[1]) : 10;

// ============================================================
// Supabase クライアント
// ============================================================
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================
// メイン処理
// ============================================================
async function main() {
  console.log(`[collect] 開始 (最大${BATCH_LIMIT}件)`);

  const { data: queue, error: queueError } = await supabase
    .from("collect_queue")
    .select("*")
    .eq("status", "pending")
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(BATCH_LIMIT);

  if (queueError) {
    console.error("[collect] キュー取得エラー:", queueError.message);
    process.exit(1);
  }

  if (!queue || queue.length === 0) {
    console.log("[collect] 処理対象なし。終了します。");
    return;
  }

  console.log(`[collect] ${queue.length}件を処理します`);

  const browser = await chromium.launch();

  for (const item of queue) {
    console.log(`\n[collect] 処理中: ${item.url}`);

    await supabase
      .from("collect_queue")
      .update({ status: "processing", started_at: new Date().toISOString() })
      .eq("queue_id", item.queue_id);

    try {
      const { screenshotPc, screenshotSp } = await takeScreenshots(
        browser,
        item.url,
      );

      const siteKey = urlToKey(item.url);
      const pcPath = `${siteKey}/pc.png`;
      const spPath = `${siteKey}/sp.png`;

      const pcUrl = await uploadScreenshot(screenshotPc, pcPath);
      const spUrl = await uploadScreenshot(screenshotSp, spPath);

      const { data: site, error: siteError } = await supabase
        .from("sites")
        .upsert(
          {
            url: item.url,
            name: item.site_name ?? extractDomain(item.url),
            collected_at: new Date().toISOString(),
          },
          { onConflict: "url" },
        )
        .select("site_id")
        .single();

      if (siteError || !site) {
        throw new Error(`sites upsert エラー: ${siteError?.message}`);
      }

      const { error: pageError } = await supabase.from("pages").upsert(
        {
          site_id: site.site_id,
          page_type: "その他・未分類",
          screenshot_pc: pcUrl,
          screenshot_sp: spUrl,
          needs_review: true,
        },
        { onConflict: "site_id,page_type" },
      );

      if (pageError) {
        throw new Error(`pages upsert エラー: ${pageError.message}`);
      }

      await supabase
        .from("collect_queue")
        .update({
          status: "done",
          completed_at: new Date().toISOString(),
        })
        .eq("queue_id", item.queue_id);

      console.log(`[collect] ✅ 完了: ${item.url}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[collect] ❌ エラー: ${item.url} - ${message}`);

      await supabase
        .from("collect_queue")
        .update({
          status: "error",
          error_message: message,
          completed_at: new Date().toISOString(),
        })
        .eq("queue_id", item.queue_id);
    }
  }

  await browser.close();
  console.log("\n[collect] 全処理完了");
}

// ============================================================
// スクリーンショット撮影
// ============================================================
async function takeScreenshots(browser: Browser, url: string) {
  const pcContext = await browser.newContext({ viewport: VIEWPORT_PC });
  const pcPage = await pcContext.newPage();
  await pcPage.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  await pcPage.waitForTimeout(1500);
  const screenshotPc = await pcPage.screenshot({ fullPage: false });
  await pcContext.close();

  const spContext = await browser.newContext({ viewport: VIEWPORT_SP });
  const spPage = await spContext.newPage();
  await spPage.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  await spPage.waitForTimeout(1500);
  const screenshotSp = await spPage.screenshot({ fullPage: false });
  await spContext.close();

  return { screenshotPc, screenshotSp };
}

// ============================================================
// Supabase Storage アップロード
// ============================================================
async function uploadScreenshot(
  buffer: Buffer,
  storagePath: string,
): Promise<string> {
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, buffer, {
      contentType: "image/png",
      upsert: true,
    });

  if (error) {
    throw new Error(`Storage upload エラー: ${error.message}`);
  }

  const { data } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(storagePath);

  return data.publicUrl;
}

// ============================================================
// ユーティリティ
// ============================================================
function urlToKey(url: string): string {
  return url
    .replace(/^https?:\/\//, "")
    .replace(/[^a-zA-Z0-9.-]/g, "_")
    .replace(/_+$/, "");
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// ============================================================
// 実行
// ============================================================
main().catch((err) => {
  console.error("[collect] 予期しないエラー:", err);
  process.exit(1);
});
