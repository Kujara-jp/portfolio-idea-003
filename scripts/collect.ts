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

      // サブページ（site_id がキューにある場合）はサイト upsert をスキップ
      let siteId: string;
      if (item.site_id) {
        siteId = item.site_id;
      } else {
        const { data: site, error: siteError } = await supabase
          .from("sites")
          .upsert(
            {
              url: item.url,
              name: item.site_name ?? extractDomain(item.url),
              region: detectRegion(item.url),
              collected_at: new Date().toISOString(),
            },
            { onConflict: "url" },
          )
          .select("site_id")
          .single();

        if (siteError || !site) {
          throw new Error(`sites upsert エラー: ${siteError?.message}`);
        }
        siteId = site.site_id;
      }

      const { error: pageError } = await supabase.from("pages").upsert(
        {
          site_id: siteId,
          page_type: item.page_type || "その他・未分類",
          page_url: item.url,
          screenshot_pc: pcUrl,
          screenshot_sp: spUrl,
          needs_review: true,
        },
        { onConflict: "site_id,page_url" },
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
  await dismissOverlays(pcPage);
  const screenshotPc = await pcPage.screenshot({ fullPage: false });
  await pcContext.close();

  const spContext = await browser.newContext({ viewport: VIEWPORT_SP });
  const spPage = await spContext.newPage();
  await spPage.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  await spPage.waitForTimeout(1500);
  await dismissOverlays(spPage);
  const screenshotSp = await spPage.screenshot({ fullPage: false });
  await spContext.close();

  return { screenshotPc, screenshotSp };
}

// ============================================================
// クッキーバナー・ポップアップ消去
// ============================================================

// クッキー同意ボタンのセレクタ（よくあるパターン）
const COOKIE_ACCEPT_SELECTORS = [
  // 汎用的なクッキー同意ボタン
  '[class*="cookie"] button[class*="accept"]',
  '[class*="cookie"] button[class*="agree"]',
  '[class*="cookie"] button[class*="allow"]',
  '[class*="cookie"] button[class*="consent"]',
  '[class*="cookie"] button[class*="close"]',
  '[id*="cookie"] button[class*="accept"]',
  '[id*="cookie"] button[class*="agree"]',
  '[id*="cookie"] button[class*="allow"]',
  // OneTrust (layers.co.jp 等)
  "#onetrust-accept-btn-handler",
  ".onetrust-close-btn-handler",
  // Cookiebot
  "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
  "#CybotCookiebotDialogBodyButtonAccept",
  // GDPR / 汎用
  '[class*="gdpr"] button',
  '[class*="consent"] button[class*="accept"]',
  '[class*="consent"] button[class*="allow"]',
  'button[class*="cookie-accept"]',
  'button[id*="cookie-accept"]',
  'a[class*="cookie-accept"]',
  // 日本語テキストボタン
  'button:has-text("同意する")',
  'button:has-text("すべて許可")',
  'button:has-text("Accept")',
  'button:has-text("Accept All")',
  'button:has-text("Accept all")',
  'button:has-text("I agree")',
  'button:has-text("Got it")',
  'button:has-text("OK")',
  'a:has-text("Accept All")',
  'a:has-text("Accept all")',
  'a:has-text("同意する")',
];

// オーバーレイ / ポップアップを非表示にするセレクタ
const OVERLAY_HIDE_SELECTORS = [
  // クッキーバナー系コンテナ
  '[class*="cookie-banner"]',
  '[class*="cookie-consent"]',
  '[class*="cookie-notice"]',
  '[id*="cookie-banner"]',
  '[id*="cookie-consent"]',
  '[id*="cookie-notice"]',
  "#onetrust-banner-sdk",
  "#CybotCookiebotDialog",
  '[class*="gdpr-banner"]',
  '[class*="consent-banner"]',
  // プロモーション・クーポンポップアップ
  '[class*="popup-overlay"]',
  '[class*="modal-overlay"]',
  '[class*="popup-modal"]',
  '[class*="promotion-popup"]',
  '[class*="coupon-popup"]',
  '[class*="newsletter-popup"]',
  '[class*="subscribe-popup"]',
  // 汎用オーバーレイ（最後に試行、誤検出リスクを下げるため条件付き）
];

// ポップアップ閉じるボタン
const POPUP_CLOSE_SELECTORS = [
  '[class*="popup"] [class*="close"]',
  '[class*="popup"] button[aria-label="Close"]',
  '[class*="modal"] [class*="close"]',
  '[class*="modal"] button[aria-label="Close"]',
  '[class*="overlay"] [class*="close"]',
  'button[class*="popup-close"]',
  'button[class*="modal-close"]',
  '[class*="newsletter"] [class*="close"]',
  '[class*="promotion"] [class*="close"]',
  '[class*="coupon"] [class*="close"]',
];

async function dismissOverlays(page: import("playwright").Page): Promise<void> {
  try {
    // Step 1: クッキー同意ボタンをクリック
    for (const selector of COOKIE_ACCEPT_SELECTORS) {
      try {
        const btn = page.locator(selector).first();
        if (await btn.isVisible({ timeout: 300 })) {
          await btn.click({ timeout: 1000 });
          console.log(`[collect]   クッキーバナー消去: ${selector}`);
          await page.waitForTimeout(500);
          break;
        }
      } catch {
        // セレクタが見つからない場合はスキップ
      }
    }

    // Step 2: ポップアップ閉じるボタンをクリック
    for (const selector of POPUP_CLOSE_SELECTORS) {
      try {
        const btn = page.locator(selector).first();
        if (await btn.isVisible({ timeout: 300 })) {
          await btn.click({ timeout: 1000 });
          console.log(`[collect]   ポップアップ消去: ${selector}`);
          await page.waitForTimeout(500);
          break;
        }
      } catch {
        // セレクタが見つからない場合はスキップ
      }
    }

    // Step 3: 残っているオーバーレイをCSS非表示にする
    await page.evaluate((selectors) => {
      for (const sel of selectors) {
        document.querySelectorAll(sel).forEach((el) => {
          (el as HTMLElement).style.display = "none";
        });
      }
      // 固定オーバーレイの背景を非表示（画面全体を覆う半透明要素）
      document.querySelectorAll('[class*="overlay"]').forEach((el) => {
        const style = window.getComputedStyle(el);
        if (
          style.position === "fixed" &&
          parseFloat(style.opacity) < 1 &&
          el.getBoundingClientRect().width > window.innerWidth * 0.8 &&
          el.getBoundingClientRect().height > window.innerHeight * 0.8
        ) {
          (el as HTMLElement).style.display = "none";
        }
      });
    }, OVERLAY_HIDE_SELECTORS);
  } catch (err) {
    // オーバーレイ消去は best-effort なのでエラーは無視
    console.log(`[collect]   オーバーレイ消去スキップ（エラー）`);
  }
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

// 日本TLD一覧
const JP_TLDS = [".jp", ".co.jp", ".or.jp", ".ne.jp", ".ac.jp", ".go.jp"];

function detectRegion(url: string): "jp" | "global" {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (JP_TLDS.some((tld) => hostname.endsWith(tld))) return "jp";
  } catch {
    // パース失敗
  }
  return "global";
}

// ============================================================
// 実行
// ============================================================
main().catch((err) => {
  console.error("[collect] 予期しないエラー:", err);
  process.exit(1);
});
