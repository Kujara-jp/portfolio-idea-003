/**
 * design-vault: URLハーベスタースクリプト
 * 以下の2ソースからURLを収集して collect_queue に投入する
 *   A. Awwwards ギャラリー（高品質サイト・無料）
 *   B. Tavily 検索（日本サイト補充・無料枠内）
 *
 * 実行方法:
 *   npx tsx scripts/harvest.ts
 *   npx tsx scripts/harvest.ts --limit=50
 *   npx tsx scripts/harvest.ts --source=awwwards
 *   npx tsx scripts/harvest.ts --source=tavily
 */

import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

// ============================================================
// 設定
// ============================================================
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY!;

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const HARVEST_LIMIT = limitArg ? parseInt(limitArg.split("=")[1]) : 50;
const sourceArg = args.find((a) => a.startsWith("--source="));
const SOURCE = sourceArg ? sourceArg.split("=")[1] : "all";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// SNSドメイン（除外用）
const SNS_DOMAINS = [
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "linkedin.com",
  "tiktok.com",
  "pinterest.com",
  "behance.net",
  "dribbble.com",
];

// ============================================================
// Tavily 検索キーワード（日本サイト用）
// ============================================================
const TAVILY_QUERIES = [
  // SaaS・テック
  "SaaS 日本 公式サイト",
  "スタートアップ 日本 サービスサイト",
  "クラウドサービス 日本 企業サイト",
  "HR テック 日本",
  // EC・ブランド
  "ファッション ブランド 日本 公式",
  "コスメ 日本 ブランドサイト",
  "食品 日本 ブランド 公式",
  "インテリア 日本 EC サイト",
  // コーポレート
  "デザイン会社 日本 コーポレートサイト",
  "広告代理店 日本 会社サイト",
  "建築設計 日本 事務所サイト",
  "コンサルティング 日本 企業サイト",
  // メディア・コミュニティ
  "日本 オンラインメディア サイト",
  "日本 クリエイター プラットフォーム",
];

// ============================================================
// メイン処理
// ============================================================
async function main() {
  console.log(`[harvest] 開始（最大${HARVEST_LIMIT}件・source=${SOURCE}）`);

  // 既存URLを取得（重複チェック用）
  const existingUrls = await fetchExistingUrls();
  console.log(`[harvest] 既存URL: ${existingUrls.size}件`);

  const collectedUrls: { url: string; source: string; priority: number }[] = [];

  // A. Awwwards スクレイピング（Playwright）
  if (SOURCE === "all" || SOURCE === "awwwards") {
    const awwwardsUrls = await harvestAwwwards(existingUrls);
    collectedUrls.push(...awwwardsUrls);
    console.log(`[harvest] Awwwards: ${awwwardsUrls.length}件取得`);
  }

  // B. Tavily 検索（日本サイト）
  if (SOURCE === "all" || SOURCE === "tavily") {
    const tavilyUrls = await harvestTavily(existingUrls);
    collectedUrls.push(...tavilyUrls);
    console.log(`[harvest] Tavily: ${tavilyUrls.length}件取得`);
  }

  if (collectedUrls.length === 0) {
    console.log("[harvest] 新規URLなし。終了します。");
    return;
  }

  // 上限まで絞る
  const toInsert = collectedUrls.slice(0, HARVEST_LIMIT);
  console.log(`[harvest] ${toInsert.length}件を collect_queue に投入します`);

  // collect_queue に INSERT
  const { error } = await supabase.from("collect_queue").insert(
    toInsert.map((item) => ({
      url: item.url,
      status: "pending",
      priority: item.priority,
    })),
  );

  if (error) {
    console.error("[harvest] INSERT エラー:", error.message);
    process.exit(1);
  }

  console.log(`\n[harvest] ✅ ${toInsert.length}件投入完了`);
  console.log(
    `[harvest]   Awwwards: ${toInsert.filter((u) => u.source === "awwwards").length}件`,
  );
  console.log(
    `[harvest]   Tavily:   ${toInsert.filter((u) => u.source === "tavily").length}件`,
  );
}

// ============================================================
// 既存URL取得（sites + collect_queue）
// ============================================================
async function fetchExistingUrls(): Promise<Set<string>> {
  const urls = new Set<string>();

  const [{ data: sites }, { data: queue }] = await Promise.all([
    supabase.from("sites").select("url"),
    supabase.from("collect_queue").select("url"),
  ]);

  for (const s of sites ?? []) urls.add(normalizeUrl(s.url));
  for (const q of queue ?? []) urls.add(normalizeUrl(q.url));

  return urls;
}

// ============================================================
// A. Awwwards スクレイピング（Playwright版）
//    Step1: /websites/nominees/ をスクロールして /sites/{slug} を収集
//    Step2: 各 /sites/{slug} ページから外部URLを取得
// ============================================================
async function harvestAwwwards(
  existingUrls: Set<string>,
): Promise<{ url: string; source: string; priority: number }[]> {
  const results: { url: string; source: string; priority: number }[] = [];

  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    // --- Step1: slugリストを収集 ---
    console.log("[harvest] Awwwards: nominees ページからslug収集中...");
    await page.goto("https://www.awwwards.com/websites/nominees/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // スクロールしてlazy load分も読み込む（5回スクロール）
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollBy(0, 1500));
      await sleep(1500);
    }

    // /sites/{slug} パターンのリンクを収集（重複除去）
    const slugLinks = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a"))
        .map((a) => a.href)
        .filter((h) => h.match(/awwwards\.com\/sites\/[^/]+$/));
      return [...new Set(links)];
    });

    console.log(`[harvest] Awwwards: ${slugLinks.length}件のslug取得`);

    // --- Step2: 各slugページから外部URLを取得 ---
    for (const slugUrl of slugLinks.slice(0, 30)) {
      // 上限30件
      try {
        await page.goto(slugUrl, {
          waitUntil: "domcontentloaded",
          timeout: 20000,
        });
        await sleep(1000);

        // SNS以外の外部リンクを取得
        const externalUrl = await page.evaluate((snsDomains: string[]) => {
          const links = Array.from(document.querySelectorAll("a"))
            .map((a) => a.href)
            .filter(
              (h) =>
                h.startsWith("http") &&
                !h.includes("awwwards.com") &&
                !snsDomains.some((sns) => h.includes(sns)),
            );
          if (links.length === 0) return null;
          // ホスト名のみで重複を排除して最初の1件
          try {
            const parsed = new URL(links[0]);
            return `${parsed.protocol}//${parsed.hostname}`;
          } catch {
            return null;
          }
        }, SNS_DOMAINS);

        if (externalUrl && !existingUrls.has(normalizeUrl(externalUrl))) {
          existingUrls.add(normalizeUrl(externalUrl));
          results.push({ url: externalUrl, source: "awwwards", priority: 1 });
        }
      } catch (err) {
        console.warn(`[harvest] Awwwards slug ${slugUrl} エラー:`, err);
      }
    }
  } finally {
    await browser.close();
  }

  return results;
}

// ============================================================
// B. Tavily 検索（日本サイト）
// ============================================================
async function harvestTavily(
  existingUrls: Set<string>,
): Promise<{ url: string; source: string; priority: number }[]> {
  const results: { url: string; source: string; priority: number }[] = [];

  for (const query of TAVILY_QUERIES) {
    try {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: TAVILY_API_KEY,
          query,
          search_depth: "basic",
          max_results: 10,
          include_domains: [],
          exclude_domains: [
            "wikipedia.org",
            "youtube.com",
            "twitter.com",
            "facebook.com",
            "instagram.com",
            "linkedin.com",
            "amazon.co.jp",
            "rakuten.co.jp",
          ],
        }),
      });

      if (!res.ok) {
        console.warn(`[harvest] Tavily "${query}" 失敗: ${res.status}`);
        continue;
      }

      const data = await res.json();
      for (const result of data.results ?? []) {
        try {
          const parsed = new URL(result.url);
          const normalized = `${parsed.protocol}//${parsed.hostname}`;
          if (!existingUrls.has(normalizeUrl(normalized))) {
            existingUrls.add(normalizeUrl(normalized));
            results.push({ url: normalized, source: "tavily", priority: 2 });
          }
        } catch {
          // URL パース失敗は無視
        }
      }

      // レート制限対策（1秒待機）
      await sleep(1000);
    } catch (err) {
      console.warn(`[harvest] Tavily "${query}" エラー:`, err);
    }
  }

  return results;
}

// ============================================================
// ユーティリティ
// ============================================================
function normalizeUrl(url: string): string {
  return url
    .toLowerCase()
    .replace(/\/$/, "")
    .replace(/^https?:\/\//, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ============================================================
// 実行
// ============================================================
main().catch((err) => {
  console.error("[harvest] 予期しないエラー:", err);
  process.exit(1);
});
