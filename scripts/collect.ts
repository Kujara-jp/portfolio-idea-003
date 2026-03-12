/**
 * design-vault: Web収集スクリプト
 * collect_queueからpendingのURLを取得し、スクリーンショットを撮影してSupabaseに保存する
 *
 * 実行方法:
 *   npx ts-node scripts/collect.ts
 *   npx ts-node scripts/collect.ts --limit=5
 *   npx tsx scripts/collect.ts --seo-only --limit=50
 */

import { chromium, type Browser, type Page } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { canonicalizeUrl, extractDomain } from "./lib/normalize";

// ============================================================
// 設定
// ============================================================
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!;
const STORAGE_BUCKET = "screenshots";

const VIEWPORT_PC = { width: 1280, height: 800 };
const VIEWPORT_SP = { width: 375, height: 812 };

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const BATCH_LIMIT = limitArg ? parseInt(limitArg.split("=")[1]) : 10;
const SEO_ONLY_MODE = args.includes("--seo-only");

// ============================================================
// Supabase クライアント
// ============================================================
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================
// SEOデータ型定義
// ============================================================
interface SeoData {
  seo_page_title: string | null;
  seo_meta_description: string | null;
  seo_og_title: string | null;
  seo_og_description: string | null;
  seo_h1_text: string | null;
  seo_h2_texts: string[];
  seo_catchcopy_text: string | null;
  seo_cta_text: string | null;
  seo_footer_cta_text: string | null;
  seo_nav_texts: string[];
  seo_keywords_top10: string[];
  seo_social_proof_texts: string[];
  seo_testimonial_texts: string[];
  seo_faq_texts: string[];
  seo_alt_texts_sample: string[];
  seo_structured_data_type: string[];
}

const EMPTY_SEO_DATA: SeoData = {
  seo_page_title: null,
  seo_meta_description: null,
  seo_og_title: null,
  seo_og_description: null,
  seo_h1_text: null,
  seo_h2_texts: [],
  seo_catchcopy_text: null,
  seo_cta_text: null,
  seo_footer_cta_text: null,
  seo_nav_texts: [],
  seo_keywords_top10: [],
  seo_social_proof_texts: [],
  seo_testimonial_texts: [],
  seo_faq_texts: [],
  seo_alt_texts_sample: [],
  seo_structured_data_type: [],
};

// ============================================================
// SEOデータ抽出（page.evaluate でDOM解析）
// ============================================================
async function extractSeoData(page: Page): Promise<SeoData> {
  try {
    return await page.evaluate(`(() => {
      var txt = function(el) {
        return el && el.textContent ? el.textContent.trim().replace(/\\s+/g, " ").slice(0, 500) : null;
      };
      var attr = function(sel, a) {
        var el = document.querySelector(sel);
        return el ? (el.getAttribute(a) || "").trim() || null : null;
      };

      var seo_page_title = document.title ? document.title.trim() : null;
      var seo_meta_description = attr('meta[name="description"]', "content");
      var seo_og_title = attr('meta[property="og:title"]', "content");
      var seo_og_description = attr('meta[property="og:description"]', "content");

      var h1 = document.querySelector("h1");
      var seo_h1_text = txt(h1);
      var seo_h2_texts = Array.from(document.querySelectorAll("h2"))
        .map(function(el) { return el.textContent ? el.textContent.trim().replace(/\\s+/g, " ") : ""; })
        .filter(Boolean).slice(0, 20);

      var seo_catchcopy_text = null;
      var hero = document.querySelector('[class*="hero"], [class*="kv"], [class*="main-visual"], [class*="fv"], [id*="hero"]');
      if (hero) {
        var heroText = hero.querySelector('p, .catch, [class*="catch"], [class*="copy"], [class*="lead"]');
        if (heroText) seo_catchcopy_text = txt(heroText);
      }

      var mainCta = document.querySelector('a[class*="cta"], button[class*="cta"], a[class*="btn-primary"], .hero a, .kv a, [class*="hero"] a[class*="btn"]');
      var seo_cta_text = txt(mainCta);

      var footerCta = document.querySelector('footer a[class*="cta"], footer a[class*="btn"], footer button[class*="cta"]');
      var seo_footer_cta_text = txt(footerCta);

      var nav = document.querySelector('nav, header nav, [role="navigation"]');
      var seo_nav_texts = nav
        ? Array.from(nav.querySelectorAll("a"))
            .map(function(a) { return a.textContent ? a.textContent.trim() : ""; })
            .filter(function(t) { return t.length > 0 && t.length < 50; }).slice(0, 20)
        : [];

      var bodyText = document.body ? document.body.innerText || "" : "";
      var words = bodyText.split(/[\\s\\u3001\\u3002\\uff01\\uff1f\\n\\r\\t,.!?;:()\\uff08\\uff09\\u300c\\u300d\\u300e\\u300f\\u3010\\u3011]+/)
        .map(function(w) { return w.trim(); })
        .filter(function(w) { return w.length >= 2 && w.length <= 20; });
      var freq = {};
      var stopWords = ["\\u3059\\u308b","\\u3053\\u3068","\\u305f\\u3081","\\u3082\\u306e","\\u305d\\u308c","\\u3053\\u308c","\\u3042\\u308a","\\u306a\\u3044","\\u3067\\u3059","\\u307e\\u3059","\\u3057\\u305f","\\u304b\\u3089","\\u3088\\u3046","The","the","and","for","that","this","with","you","are","have","our","more","about","your"];
      words.forEach(function(w) {
        if (stopWords.indexOf(w) === -1) freq[w] = (freq[w] || 0) + 1;
      });
      var seo_keywords_top10 = Object.entries(freq)
        .sort(function(a, b) { return b[1] - a[1]; }).slice(0, 10)
        .map(function(e) { return e[0]; });

      var proofPattern = /(\\d[\\d,.]+[\\s]*[\\u793e\\u4ef6\\u540d\\u4e07\\u4eba%\\uff0b+]|\\u5c0e\\u5165|\\u5b9f\\u7e3e|\\u53d7\\u8cde|No\\.\\s*1)/;
      var seo_social_proof_texts = Array.from(document.querySelectorAll("p, span, div, li, dt, dd"))
        .map(function(el) { return el.textContent ? el.textContent.trim() : ""; })
        .filter(function(t) { return t.length > 5 && t.length < 200 && proofPattern.test(t); })
        .slice(0, 10);

      var testimonialSection = document.querySelector('[class*="testimonial"], [class*="voice"], [class*="review"], [id*="voice"]');
      var seo_testimonial_texts = testimonialSection
        ? Array.from(testimonialSection.querySelectorAll('p, blockquote, [class*="text"]'))
            .map(function(el) { return el.textContent ? el.textContent.trim().replace(/\\s+/g, " ") : ""; })
            .filter(function(t) { return t.length > 10 && t.length < 500; }).slice(0, 5)
        : [];

      var faqSection = document.querySelector('[class*="faq"], [class*="accordion"], [id*="faq"], details');
      var seo_faq_texts = faqSection
        ? Array.from(faqSection.querySelectorAll('summary, dt, [class*="question"], h3, h4'))
            .map(function(el) { return el.textContent ? el.textContent.trim() : ""; })
            .filter(function(t) { return t.length > 3 && t.length < 300; }).slice(0, 10)
        : [];

      var seo_alt_texts_sample = Array.from(document.querySelectorAll("img[alt]"))
        .map(function(img) { return (img.getAttribute("alt") || "").trim(); })
        .filter(function(t) { return t.length > 2 && t.length < 200; }).slice(0, 5);

      var ldScripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
      var seo_structured_data_type = [];
      ldScripts.forEach(function(script) {
        try {
          var json = JSON.parse(script.textContent || "");
          var types = Array.isArray(json) ? json.map(function(j) { return j["@type"]; }) : [json["@type"]];
          types.filter(Boolean).forEach(function(t) {
            if (seo_structured_data_type.indexOf(t) === -1) seo_structured_data_type.push(t);
          });
        } catch(e) {}
      });

      return {
        seo_page_title: seo_page_title,
        seo_meta_description: seo_meta_description,
        seo_og_title: seo_og_title,
        seo_og_description: seo_og_description,
        seo_h1_text: seo_h1_text,
        seo_h2_texts: seo_h2_texts,
        seo_catchcopy_text: seo_catchcopy_text,
        seo_cta_text: seo_cta_text,
        seo_footer_cta_text: seo_footer_cta_text,
        seo_nav_texts: seo_nav_texts,
        seo_keywords_top10: seo_keywords_top10,
        seo_social_proof_texts: seo_social_proof_texts,
        seo_testimonial_texts: seo_testimonial_texts,
        seo_faq_texts: seo_faq_texts,
        seo_alt_texts_sample: seo_alt_texts_sample,
        seo_structured_data_type: seo_structured_data_type
      };
    })()`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[collect]   SEOデータ抽出スキップ: ${msg}`);
    return { ...EMPTY_SEO_DATA };
  }
}

// ============================================================
// メイン処理
// ============================================================
async function main() {
  if (SEO_ONLY_MODE) {
    await runSeoOnly();
    return;
  }

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
      const { screenshotPc, screenshotSp, seoData } = await takeScreenshots(
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
        const canonicalUrl = canonicalizeUrl(item.url);
        const { data: site, error: siteError } = await supabase
          .from("sites")
          .upsert(
            {
              url: canonicalUrl,
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
          page_url: canonicalizeUrl(item.url),
          screenshot_pc: pcUrl,
          screenshot_sp: spUrl,
          needs_review: true,
          ...seoData,
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
async function takeScreenshots(
  browser: Browser,
  url: string,
): Promise<{ screenshotPc: Buffer; screenshotSp: Buffer; seoData: SeoData }> {
  const pcContext = await browser.newContext({ viewport: VIEWPORT_PC });
  const pcPage = await pcContext.newPage();
  await pcPage.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  await pcPage.waitForTimeout(1500);
  await dismissOverlays(pcPage);

  // SEOデータ抽出（PCページから。SPは同一HTMLなので不要）
  const seoData = await extractSeoData(pcPage);
  if (seoData.seo_page_title) {
    console.log(`[collect]   SEO: title="${seoData.seo_page_title}"`);
  }

  const screenshotPc = await pcPage.screenshot({ fullPage: false });
  await pcContext.close();

  const spContext = await browser.newContext({ viewport: VIEWPORT_SP });
  const spPage = await spContext.newPage();
  await spPage.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  await spPage.waitForTimeout(1500);
  await dismissOverlays(spPage);
  const screenshotSp = await spPage.screenshot({ fullPage: false });
  await spContext.close();

  return { screenshotPc, screenshotSp, seoData };
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
// --seo-only モード: 既存ページのSEOデータのみ収集
// ============================================================
async function runSeoOnly() {
  console.log(`[collect] SEO-onlyモード開始 (最大${BATCH_LIMIT}件)`);

  const { data: pages, error } = await supabase
    .from("pages")
    .select("page_id, page_url")
    .is("seo_page_title", null)
    .not("screenshot_pc", "is", null)
    .limit(BATCH_LIMIT);

  if (error) {
    console.error("[collect] ページ取得エラー:", error.message);
    process.exit(1);
  }

  if (!pages || pages.length === 0) {
    console.log("[collect] SEO未収集ページなし。終了します。");
    return;
  }

  console.log(`[collect] ${pages.length}件のSEOデータを収集します`);

  const browser = await chromium.launch();

  for (const page of pages) {
    console.log(`\n[collect] SEO収集: ${page.page_url}`);
    try {
      const context = await browser.newContext({ viewport: VIEWPORT_PC });
      const browserPage = await context.newPage();
      await browserPage.goto(page.page_url, {
        waitUntil: "networkidle",
        timeout: 30000,
      });
      await browserPage.waitForTimeout(1500);
      await dismissOverlays(browserPage);

      const seoData = await extractSeoData(browserPage);
      await context.close();

      const { error: updateError } = await supabase
        .from("pages")
        .update(seoData)
        .eq("page_id", page.page_id);

      if (updateError) {
        throw new Error(`pages更新エラー: ${updateError.message}`);
      }

      const title = seoData.seo_page_title ?? "(なし)";
      console.log(`[collect] SEO完了: title="${title}"`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[collect] SEOエラー: ${page.page_url} - ${message}`);
    }
  }

  await browser.close();
  console.log("\n[collect] SEO-only 全処理完了");
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
