/**
 * design-vault: 業種バランスチェック・自動補充スクリプト
 *
 * DBの業種分布を集計し、Skova Digitalターゲット業種（美容・飲食・不動産・医療）が
 * 不足している場合にSANKOU!/WebDesignClipカテゴリから優先的に collect_queue へ投入する。
 *
 * 実行方法:
 *   npx tsx scripts/balance-check.ts           # レポート表示のみ
 *   npx tsx scripts/balance-check.ts --fix      # 不足業種を自動補充
 *   npx tsx scripts/balance-check.ts --fix --limit=100
 */

import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { canonicalizeUrl, normalizeForDedup } from "./lib/normalize";

// ============================================================
// 設定
// ============================================================
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!;

const args = process.argv.slice(2);
const FIX_MODE = args.includes("--fix");
const limitArg = args.find((a) => a.startsWith("--limit="));
const FIX_LIMIT = limitArg ? parseInt(limitArg.split("=")[1]) : 50;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================
// Skova優先業種の定義
// ============================================================

/** 充足目標数（業種ごとの最低サイト数） */
const TARGET_COUNTS: Record<string, number> = {
  "美容・コスメ": 80,
  "飲食・フード": 80,
  "不動産・建築": 60,
  "医療・ヘルスケア": 60,
  "スポーツ・フィットネス": 40,
  "コンサルティング・士業": 30,
  "テクノロジー・SaaS": 40,
};

/** 不足業種に対して補充するSANKOU!カテゴリのマッピング */
const INDUSTRY_TO_SANKOU: Record<string, string[]> = {
  "美容・コスメ": ["salon", "beauty-cosmetics-caregoods"],
  "飲食・フード": ["cafe-restaurant-tavern", "cooking-food-beverage"],
  "不動産・建築": ["architecture-construction-realestate-home-garden"],
  "医療・ヘルスケア": ["hospital-clinic-medicalcare-dentist"],
  "スポーツ・フィットネス": ["health-sport"],
  "コンサルティング・士業": ["bank-insurance-finance-law"],
  "テクノロジー・SaaS": ["it-internet-media"],
};

/** 不足業種に対して補充するWebDesignClipカテゴリのマッピング */
const INDUSTRY_TO_WDC: Record<string, string[]> = {
  "美容・コスメ": ["beauty"],
  "飲食・フード": ["eat-drink", "food"],
  "不動産・建築": ["estate"],
  "医療・ヘルスケア": ["hospital"],
  "スポーツ・フィットネス": ["sports"],
  "コンサルティング・士業": [],
  "テクノロジー・SaaS": ["company"],
};

// SNSドメイン（除外用）
const SNS_DOMAINS = [
  "facebook.com", "instagram.com", "twitter.com", "x.com",
  "youtube.com", "linkedin.com", "tiktok.com", "pinterest.com",
  "tabelog.com", "hotpepper.jp", "amazon.co.jp", "rakuten.co.jp",
  "wikipedia.org", "google.com", "yahoo.co.jp",
  "ameblo.jp", "note.com", "wix.com", "stores.jp", "base.shop",
];

// ============================================================
// メイン
// ============================================================
async function main() {
  console.log("[balance-check] 業種バランス分析を開始...\n");

  // 1. 現在の業種分布を集計
  const { data: sites, error } = await supabase
    .from("sites")
    .select("industry_category")
    .not("industry_category", "is", null)
    .not("is_blocked", "eq", true);

  if (error) {
    console.error("[balance-check] データ取得エラー:", error.message);
    process.exit(1);
  }

  const countMap: Record<string, number> = {};
  for (const s of sites ?? []) {
    const cat = s.industry_category as string;
    countMap[cat] = (countMap[cat] || 0) + 1;
  }

  // 2. レポート表示
  const totalClassified = Object.values(countMap).reduce((a, b) => a + b, 0);
  console.log(`分類済みサイト総数: ${totalClassified}\n`);
  console.log("── Skova優先業種バランス ──────────────────────────");
  console.log(
    `${"業種".padEnd(22)} ${"現在".padStart(5)} ${"目標".padStart(5)} ${"充足率".padStart(6)} ${"状態"}`,
  );
  console.log("─".repeat(55));

  const shortfalls: { industry: string; shortfall: number }[] = [];

  for (const [industry, target] of Object.entries(TARGET_COUNTS)) {
    const current = countMap[industry] ?? 0;
    const ratio = Math.round((current / target) * 100);
    const bar = ratio >= 100 ? "✅" : ratio >= 60 ? "🟡" : "🔴";
    const shortfall = Math.max(0, target - current);
    if (shortfall > 0) shortfalls.push({ industry, shortfall });

    console.log(
      `${industry.padEnd(22)} ${String(current).padStart(5)} ${String(target).padStart(5)} ${String(ratio + "%").padStart(6)} ${bar}`,
    );
  }

  console.log("\n── その他業種 ──────────────────────────────────────");
  const otherEntries = Object.entries(countMap)
    .filter(([k]) => !TARGET_COUNTS[k])
    .sort((a, b) => b[1] - a[1]);
  for (const [industry, count] of otherEntries) {
    console.log(`  ${industry.padEnd(22)} ${count}`);
  }

  if (shortfalls.length === 0) {
    console.log("\n✅ 全優先業種が目標数に達しています。");
    return;
  }

  console.log(`\n不足業種: ${shortfalls.length}件`);
  for (const { industry, shortfall } of shortfalls) {
    console.log(`  - ${industry}: あと${shortfall}件`);
  }

  if (!FIX_MODE) {
    console.log(
      "\n補充するには --fix フラグを付けて再実行してください:\n  npx tsx scripts/balance-check.ts --fix",
    );
    return;
  }

  // 3. 補充モード: 既存URLを取得して重複チェック
  const { data: existingSites } = await supabase.from("sites").select("url");
  const { data: existingQueue } = await supabase
    .from("collect_queue")
    .select("url");

  const existingUrls = new Set<string>();
  for (const s of existingSites ?? []) existingUrls.add(normalizeForDedup(s.url));
  for (const q of existingQueue ?? []) existingUrls.add(normalizeForDedup(q.url));

  console.log(`\n[balance-check] 既存URL: ${existingUrls.size}件`);
  console.log("[balance-check] 不足業種の補充を開始...\n");

  const newUrls: { url: string; priority: number }[] = [];

  // 優先度高い業種から順に補充（不足量が多い順）
  const sortedShortfalls = shortfalls.sort((a, b) => b.shortfall - a.shortfall);

  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    for (const { industry, shortfall } of sortedShortfalls) {
      const sankouCats = INDUSTRY_TO_SANKOU[industry] ?? [];
      const wdcCats = INDUSTRY_TO_WDC[industry] ?? [];

      console.log(
        `[balance-check] ${industry}（不足${shortfall}件）を補充中...`,
      );

      // SANKOU!からURL収集
      for (const cat of sankouCats) {
        const urls = await scrapeGalleryUrls(
          page,
          `https://sankoudesign.com/category/${cat}/`,
          'a[target="_blank"][rel="noopener"]',
          "sankoudesign.com",
          existingUrls,
        );
        newUrls.push(...urls.map((u) => ({ url: u, priority: 1 })));
        console.log(
          `  SANKOU! /${cat}/: ${urls.length}件追加`,
        );
        await sleep(1500);
      }

      // WebDesignClipからURL収集
      for (const cat of wdcCats) {
        const urls = await scrapeGalleryUrls(
          page,
          `https://webdesignclip.com/category/${cat}/`,
          'a[aria-label="launch"]',
          "webdesignclip.com",
          existingUrls,
        );
        newUrls.push(...urls.map((u) => ({ url: u, priority: 1 })));
        console.log(
          `  WebDesignClip /${cat}/: ${urls.length}件追加`,
        );
        await sleep(1500);
      }

      // 十分に収集できたら次の業種へ
      if (newUrls.length >= FIX_LIMIT) break;
    }
  } finally {
    await browser.close();
  }

  if (newUrls.length === 0) {
    console.log("[balance-check] 新規URLが取得できませんでした。");
    return;
  }

  // 4. collect_queue に投入
  const toInsert = newUrls.slice(0, FIX_LIMIT);
  console.log(
    `\n[balance-check] ${toInsert.length}件を collect_queue に投入...`,
  );

  const { error: insertError } = await supabase.from("collect_queue").insert(
    toInsert.map((item) => ({
      url: canonicalizeUrl(item.url),
      status: "pending",
      priority: item.priority,
      normalized_url: normalizeForDedup(item.url),
    })),
  );

  if (insertError) {
    console.error("[balance-check] INSERT エラー:", insertError.message);
    process.exit(1);
  }

  console.log(`[balance-check] ✅ ${toInsert.length}件投入完了`);
}

// ============================================================
// ギャラリーページからURL収集（共通ヘルパー）
// ============================================================
async function scrapeGalleryUrls(
  page: import("playwright").Page,
  url: string,
  selector: string,
  ownDomain: string,
  existingUrls: Set<string>,
): Promise<string[]> {
  try {
    const res = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    if (!res || res.status() === 404) return [];

    const hrefs = await page.evaluate(
      ({ sel, own, sns }: { sel: string; own: string; sns: string[] }) => {
        const seen = new Set<string>();
        const result: string[] = [];
        for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>(sel))) {
          const h = a.href;
          if (!h.startsWith("http") || h.includes(own) || sns.some((s) => h.includes(s))) continue;
          try {
            const parsed = new URL(h);
            const normalized = `${parsed.protocol}//${parsed.hostname}`;
            if (!seen.has(parsed.hostname)) {
              seen.add(parsed.hostname);
              result.push(normalized);
            }
          } catch { /* skip */ }
        }
        return result;
      },
      { sel: selector, own: ownDomain, sns: SNS_DOMAINS },
    );

    return hrefs.filter((u) => !existingUrls.has(normalizeForDedup(u)));
  } catch {
    return [];
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ============================================================
// 実行
// ============================================================
main().catch((err) => {
  console.error("[balance-check] 予期しないエラー:", err);
  process.exit(1);
});
