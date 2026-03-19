/**
 * design-vault Phase 12b: フルページ分割スクリーンショット収集スクリプト
 *
 * 目的:
 *   既存の screenshot_pc/sp（ヒーローのみ）を補完し、
 *   ページ全体を縦1200px区切りで分割スクショして pages.screenshots_full に保存する。
 *   エージェントがフルページのデザインパターンを参照できるようにする。
 *
 * 実行方法:
 *   npx tsx scripts/collect-full-screenshots.ts
 *   npx tsx scripts/collect-full-screenshots.ts --limit=20
 *   npx tsx scripts/collect-full-screenshots.ts --limit=5 --min-quality=4
 *
 * オプション:
 *   --limit=N        処理件数上限（デフォルト: 20）
 *   --min-quality=N  最低品質スコア（デフォルト: 3）
 *   --force          screenshots_full が既存でも再収集する
 */

import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { canonicalizeUrl } from "./lib/normalize";

// ============================================================
// 設定
// ============================================================
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!;
const STORAGE_BUCKET = "screenshots";

// フルページスクショの設定
const VIEWPORT_WIDTH = 1280;
const SEGMENT_HEIGHT = 1200; // 縦の分割単位（px）
const MAX_SEGMENTS = 8;      // 最大分割数（= 最大 9,600px まで）

// CLIオプション解析
const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const qualityArg = args.find((a) => a.startsWith("--min-quality="));
const BATCH_LIMIT = limitArg ? parseInt(limitArg.split("=")[1]) : 20;
const MIN_QUALITY = qualityArg ? parseInt(qualityArg.split("=")[1]) : 3;
const FORCE_RECOLLECT = args.includes("--force");

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================
// フルページ分割スクショ撮影
// ============================================================
async function takeFullPageScreenshots(
  url: string,
): Promise<string[]> {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: VIEWPORT_WIDTH, height: SEGMENT_HEIGHT },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(1500);

    // クッキーバナー・ポップアップを消去
    await dismissOverlays(page);

    // ページ全体の高さを取得
    const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    console.log(`[full-ss]   ページ高さ: ${pageHeight}px`);

    // 分割数を計算（最大MAX_SEGMENTSまで）
    const segmentCount = Math.min(
      Math.ceil(pageHeight / SEGMENT_HEIGHT),
      MAX_SEGMENTS,
    );
    console.log(`[full-ss]   分割数: ${segmentCount}`);

    const screenshotBuffers: Buffer[] = [];

    for (let i = 0; i < segmentCount; i++) {
      const scrollY = i * SEGMENT_HEIGHT;

      // 指定位置にスクロールしてスクショ
      await page.evaluate((y) => window.scrollTo(0, y), scrollY);
      await page.waitForTimeout(300); // アニメーション待機

      const buffer = await page.screenshot({ fullPage: false });
      screenshotBuffers.push(buffer);
      console.log(`[full-ss]   セグメント ${i + 1}/${segmentCount} 撮影完了`);
    }

    return screenshotBuffers.map((_, i) => i.toString()); // インデックスを返す（アップロードは呼び出し元で）

    // NOTE: Buffer配列を返したいが、TS型の都合でBufferを一緒に返す構造に変更
    // 以下の実装では Buffer と index を pair で返す
  } finally {
    await context.close();
    await browser.close();
  }
}

// Buffer配列を含む戻り値の正しい実装
async function captureSegments(
  url: string,
): Promise<Buffer[]> {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: VIEWPORT_WIDTH, height: SEGMENT_HEIGHT },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(1500);
    await dismissOverlays(page);

    const pageHeight = await page.evaluate(
      () => document.documentElement.scrollHeight,
    );
    console.log(`[full-ss]   ページ高さ: ${pageHeight}px`);

    const segmentCount = Math.min(
      Math.ceil(pageHeight / SEGMENT_HEIGHT),
      MAX_SEGMENTS,
    );
    console.log(`[full-ss]   分割数: ${segmentCount}`);

    const buffers: Buffer[] = [];

    for (let i = 0; i < segmentCount; i++) {
      const scrollY = i * SEGMENT_HEIGHT;
      await page.evaluate((y) => window.scrollTo(0, y), scrollY);
      await page.waitForTimeout(300);

      const buf = await page.screenshot({ fullPage: false });
      buffers.push(buf);
      console.log(`[full-ss]   セグメント ${i + 1}/${segmentCount} 撮影完了`);
    }

    return buffers;
  } finally {
    await context.close();
    await browser.close();
  }
}

// ============================================================
// Storage アップロード
// ============================================================
async function uploadSegment(
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

  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}

function urlToKey(url: string): string {
  return url
    .replace(/^https?:\/\//, "")
    .replace(/[^a-zA-Z0-9.-]/g, "_")
    .replace(/_+$/, "");
}

// ============================================================
// クッキーバナー・ポップアップ消去（collect.ts から抜粋）
// ============================================================
const COOKIE_ACCEPT_SELECTORS = [
  '[class*="cookie"] button[class*="accept"]',
  '[class*="cookie"] button[class*="agree"]',
  '[class*="cookie"] button[class*="allow"]',
  "#onetrust-accept-btn-handler",
  "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
  "#CybotCookiebotDialogBodyButtonAccept",
  'button:has-text("同意する")',
  'button:has-text("すべて許可")',
  'button:has-text("Accept All")',
  'button:has-text("Accept all")',
  'button:has-text("OK")',
];

const OVERLAY_HIDE_SELECTORS = [
  '[class*="cookie-banner"]',
  '[class*="cookie-consent"]',
  '[class*="cookie-notice"]',
  "#onetrust-banner-sdk",
  "#CybotCookiebotDialog",
  '[class*="popup-overlay"]',
  '[class*="modal-overlay"]',
  '[class*="newsletter-popup"]',
];

const POPUP_CLOSE_SELECTORS = [
  '[class*="popup"] [class*="close"]',
  '[class*="modal"] [class*="close"]',
  'button[class*="popup-close"]',
  'button[class*="modal-close"]',
];

async function dismissOverlays(page: import("playwright").Page): Promise<void> {
  try {
    for (const selector of COOKIE_ACCEPT_SELECTORS) {
      try {
        const btn = page.locator(selector).first();
        if (await btn.isVisible({ timeout: 300 })) {
          await btn.click({ timeout: 1000 });
          await page.waitForTimeout(500);
          break;
        }
      } catch { /* セレクタ不一致はスキップ */ }
    }

    for (const selector of POPUP_CLOSE_SELECTORS) {
      try {
        const btn = page.locator(selector).first();
        if (await btn.isVisible({ timeout: 300 })) {
          await btn.click({ timeout: 1000 });
          await page.waitForTimeout(500);
          break;
        }
      } catch { /* セレクタ不一致はスキップ */ }
    }

    await page.evaluate((selectors) => {
      for (const sel of selectors) {
        document.querySelectorAll(sel).forEach((el) => {
          (el as HTMLElement).style.display = "none";
        });
      }
    }, OVERLAY_HIDE_SELECTORS);
  } catch {
    console.log(`[full-ss]   オーバーレイ消去スキップ`);
  }
}

// ============================================================
// メイン処理
// ============================================================
async function main() {
  console.log(`[full-ss] 開始 (最大${BATCH_LIMIT}件, min_quality=${MIN_QUALITY})`);

  // 未収集ページを取得（quality_score は sites テーブル側にある）
  let query = supabase
    .from("pages")
    .select("page_id, page_url, sites!inner(quality_score)")
    .eq("is_blocked", false)
    .not("sites.quality_score", "is", null)
    .gte("sites.quality_score", MIN_QUALITY)
    .order("sites(quality_score)", { ascending: false })
    .limit(BATCH_LIMIT);

  if (!FORCE_RECOLLECT) {
    query = query.is("screenshots_full", null);
  }

  const { data: pages, error } = await query;

  if (error) {
    console.error("[full-ss] ページ取得エラー:", error.message);
    process.exit(1);
  }

  if (!pages || pages.length === 0) {
    console.log("[full-ss] 収集対象なし。終了します。");
    return;
  }

  console.log(`[full-ss] ${pages.length}件を処理します`);

  let successCount = 0;
  let errorCount = 0;

  for (const dbPage of pages) {
    const siteInfo = (dbPage as Record<string, unknown>).sites as Record<string, unknown> | null;
    const qualityScore = Array.isArray(siteInfo) ? (siteInfo[0]?.quality_score ?? null) : (siteInfo?.quality_score ?? null);
    console.log(`\n[full-ss] 処理中: ${dbPage.page_url} (quality=${qualityScore})`);

    try {
      const segments = await captureSegments(dbPage.page_url);

      if (segments.length === 0) {
        console.log(`[full-ss] スクショ取得失敗: ${dbPage.page_url}`);
        errorCount++;
        continue;
      }

      // Storage にアップロード
      const siteKey = urlToKey(dbPage.page_url);
      const urls: string[] = [];

      for (let i = 0; i < segments.length; i++) {
        const storagePath = `${siteKey}/full_${i}.png`;
        const publicUrl = await uploadSegment(segments[i], storagePath);
        urls.push(publicUrl);
      }

      // pages テーブルを更新
      const { error: updateError } = await supabase
        .from("pages")
        .update({ screenshots_full: urls })
        .eq("page_id", dbPage.page_id);

      if (updateError) {
        throw new Error(`pages更新エラー: ${updateError.message}`);
      }

      console.log(`[full-ss] ✅ 完了: ${segments.length}枚 → ${dbPage.page_url}`);
      successCount++;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[full-ss] ❌ エラー: ${dbPage.page_url} - ${message}`);
      errorCount++;
    }
  }

  console.log(`\n[full-ss] 全処理完了 (成功: ${successCount}, エラー: ${errorCount})`);
}

main().catch((err) => {
  console.error("[full-ss] 予期しないエラー:", err);
  process.exit(1);
});
