/**
 * design-vault: サブページ発見スクリプト
 * 既存サイトのサブページURLを発見・分類し、collect_queueに投入する
 *
 * 処理フロー:
 *   1. sites から subpages_discovered=false のサイトを取得
 *   2. 各サイトについて:
 *      a. robots.txt を取得し Disallow ルールを解析
 *      b. sitemap.xml を取得・パース
 *      c. sitemap が3件未満 → Playwright でホームページリンクをクロール
 *      d. URLパスからページ種別をヒューリスティック分類
 *      e. 最大9件を collect_queue に INSERT
 *      f. sites.subpages_discovered = true に更新
 *
 * 実行方法:
 *   npx tsx scripts/discover.ts
 *   npx tsx scripts/discover.ts --limit=5
 */

import { chromium, type Browser } from "playwright";
import { createClient } from "@supabase/supabase-js";

// ============================================================
// 設定
// ============================================================
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;

const MAX_SUBPAGES = 9;
const SITEMAP_MIN_THRESHOLD = 3;
const MAX_SITEMAP_URLS = 500;
const SITE_TIMEOUT_MS = 60_000;

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? parseInt(limitArg.split("=")[1]) : 20;

// ============================================================
// ページ種別マッピング
// ============================================================
type PageType = string;

const PATH_PATTERNS: { pattern: RegExp; pageType: PageType }[] = [
  { pattern: /\/(about|company|corporate|会社概要)/i, pageType: "会社概要・About" },
  { pattern: /\/(contact|inquiry|お問い合わせ)/i, pageType: "お問い合わせ" },
  { pattern: /\/(news|お知らせ)/i, pageType: "ニュース・お知らせ" },
  { pattern: /\/(blog|journal|magazine)/i, pageType: "ブログ・オウンドメディア" },
  { pattern: /\/(recruit|career|jobs|採用)/i, pageType: "採用サイト" },
  { pattern: /\/(service|solution|サービス)/i, pageType: "サービス紹介" },
  { pattern: /\/(pricing|plan|料金)/i, pageType: "料金・プラン" },
  { pattern: /\/(case|works|portfolio|実績)/i, pageType: "事例・実績" },
  { pattern: /\/(team|staff|member|スタッフ)/i, pageType: "スタッフ・チーム紹介" },
  { pattern: /\/(login|signin|signup|register)/i, pageType: "ログイン・会員登録" },
  { pattern: /\/(privacy|terms|利用規約)/i, pageType: "プライバシーポリシー・利用規約" },
  { pattern: /\/(event|campaign)/i, pageType: "イベント・キャンペーン" },
  { pattern: /\/(download|whitepaper|資料)/i, pageType: "資料請求・ダウンロード" },
  { pattern: /\/(booking|reserve|予約)/i, pageType: "予約・booking" },
  { pattern: /\/(lp|landing)/i, pageType: "LP（ランディングページ）" },
  { pattern: /\/(compare|feature|特長|比較)/i, pageType: "比較・特長" },
  { pattern: /\/(product|item|detail|商品)/i, pageType: "商品・物件・案件詳細" },
  { pattern: /\/(search|results|検索)/i, pageType: "検索結果・一覧" },
  { pattern: /\/(404|not-found)/i, pageType: "404" },
  { pattern: /\/(error|maintenance|メンテナンス)/i, pageType: "エラー・メンテナンス" },
  { pattern: /\/(thanks|thank-you|complete|完了)/i, pageType: "サンクス・完了" },
  { pattern: /\/(dashboard|mypage|マイページ)/i, pageType: "ダッシュボード・マイページ" },
  { pattern: /\/(onboarding|tutorial|getting-started)/i, pageType: "Onboarding・チュートリアル" },
  { pattern: /\/(ranking|popular|おすすめ)/i, pageType: "ランキング・おすすめ" },
  { pattern: /\/(gallery|catalog|一覧)/i, pageType: "検索結果・一覧" },
];

// ============================================================
// Supabase クライアント
// ============================================================
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================
// メイン処理
// ============================================================
async function main() {
  console.log(`[discover] 開始（最大${LIMIT}サイト）`);

  // subpages_discovered=false かつ ブロックされていないサイトを取得
  // is_blocked が NULL（初期値）のサイトも対象にする
  const { data: sites, error: sitesError } = await supabase
    .from("sites")
    .select("site_id, url")
    .eq("subpages_discovered", false)
    .or("is_blocked.eq.false,is_blocked.is.null")
    .order("created_at", { ascending: true })
    .limit(LIMIT);

  if (sitesError) {
    console.error("[discover] サイト取得エラー:", sitesError.message);
    process.exit(1);
  }

  if (!sites || sites.length === 0) {
    console.log("[discover] 処理対象なし。終了します。");
    return;
  }

  console.log(`[discover] ${sites.length}サイトを処理します`);

  const browser = await chromium.launch();

  for (const site of sites) {
    console.log(`\n[discover] 処理中: ${site.url}`);

    try {
      await Promise.race([
        discoverSubpages(browser, site.site_id, site.url),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("タイムアウト (60s)")), SITE_TIMEOUT_MS),
        ),
      ]);
      // 成功時のみ処理済みに更新（エラー時は次回再試行）
      const { error: updateError } = await supabase
        .from("sites")
        .update({ subpages_discovered: true })
        .eq("site_id", site.site_id);
      if (updateError) {
        console.error(`[discover] ⚠ subpages_discovered 更新失敗: ${site.url} - ${updateError.message}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[discover] ❌ エラー: ${site.url} - ${message}`);
      // エラーでもスキップして次のサイトへ進むため処理済みにする
      await supabase
        .from("sites")
        .update({ subpages_discovered: true })
        .eq("site_id", site.site_id);
    }
  }

  await browser.close();
  console.log("\n[discover] 全処理完了");
}

// ============================================================
// サブページ発見処理
// ============================================================
async function discoverSubpages(
  browser: Browser,
  siteId: string,
  siteUrl: string,
) {
  const origin = new URL(siteUrl).origin;

  // 既存ページの page_url を取得（重複排除用）
  const { data: existingPages } = await supabase
    .from("pages")
    .select("page_url")
    .eq("site_id", siteId);

  const existingUrls = new Set(
    (existingPages ?? [])
      .map((p: { page_url: string | null }) => p.page_url)
      .filter((url): url is string => url !== null),
  );

  // 1. robots.txt を取得
  const disallowRules = await fetchRobotsTxt(origin);

  // 2. sitemap.xml からURL取得
  let urls = await fetchSitemapUrls(origin);

  // 3. sitemap が少ない場合 → ホームページリンクをクロール
  if (urls.length < SITEMAP_MIN_THRESHOLD) {
    console.log(
      `[discover] sitemap ${urls.length}件 → ホームページリンクをクロール`,
    );
    const crawledUrls = await crawlHomepageLinks(browser, siteUrl, origin);
    // sitemap のURLとマージ（重複排除）
    const urlSet = new Set([...urls, ...crawledUrls]);
    urls = Array.from(urlSet);
  }

  // 4. フィルタリング: 同一オリジン、robots.txt除外、ホームページ自身を除外
  const normalizedSiteUrl = normalizeUrl(siteUrl);
  urls = urls.filter((url) => {
    try {
      if (new URL(url).origin !== origin) return false;
    } catch {
      return false;
    }
    if (normalizeUrl(url) === normalizedSiteUrl) return false;
    if (isDisallowed(url, origin, disallowRules)) return false;
    return true;
  });

  // 5. ページ種別を分類
  const classified = urls.map((url) => ({
    url,
    pageType: classifyPageType(url),
  }));

  // 6. 選択ロジック: 多様なページ種別優先、既存URL重複排除
  const selected = selectSubpages(classified, existingUrls);

  if (selected.length === 0) {
    console.log(`[discover] サブページなし: ${siteUrl}`);
    return;
  }

  // 7. collect_queue に投入
  const queueItems = selected.map((item) => ({
    url: item.url,
    site_id: siteId,
    page_type: item.pageType,
    priority: 5,
    status: "pending",
    source: "discover",
  }));

  const { error: insertError } = await supabase
    .from("collect_queue")
    .insert(queueItems);

  if (insertError) {
    throw new Error(`collect_queue insert エラー: ${insertError.message}`);
  }

  console.log(`[discover] ✅ ${selected.length}件を collect_queue に投入: ${siteUrl}`);
}

// ============================================================
// robots.txt 取得
// ============================================================
async function fetchRobotsTxt(origin: string): Promise<string[]> {
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const text = await res.text();

    // User-agent: * のセクションのみ解析する
    // 他の bot 固有のルールを自分に適用しない
    const rules: string[] = [];
    let inWildcardSection = false;

    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("#")) continue;

      const lower = trimmed.toLowerCase();
      if (lower.startsWith("user-agent:")) {
        const agent = lower.slice("user-agent:".length).trim();
        inWildcardSection = agent === "*";
        continue;
      }

      if (inWildcardSection && lower.startsWith("disallow:")) {
        const path = trimmed.slice("disallow:".length).trim();
        if (path) rules.push(path);
      }
    }
    return rules;
  } catch {
    return [];
  }
}

// ============================================================
// sitemap.xml 取得
// ============================================================
async function fetchSitemapUrls(origin: string): Promise<string[]> {
  const urls: string[] = [];
  await parseSitemap(`${origin}/sitemap.xml`, urls, 0);
  return urls;
}

const SITEMAP_MAX_DEPTH = 2;

async function parseSitemap(
  sitemapUrl: string,
  urls: string[],
  depth: number,
): Promise<void> {
  if (depth > SITEMAP_MAX_DEPTH) return;
  if (urls.length >= MAX_SITEMAP_URLS) return;

  try {
    const res = await fetch(sitemapUrl, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return;
    const text = await res.text();

    // sitemap index かどうかを判定
    const isSitemapIndex = /<sitemapindex/i.test(text);

    const locRegex = /<loc>\s*(.*?)\s*<\/loc>/gi;
    let match: RegExpExecArray | null;
    while ((match = locRegex.exec(text)) !== null) {
      if (urls.length >= MAX_SITEMAP_URLS) break;
      const url = match[1].trim();
      if (!url.startsWith("http")) continue;

      if (isSitemapIndex) {
        // 子 sitemap を再帰的に辿る
        await parseSitemap(url, urls, depth + 1);
      } else {
        urls.push(url);
      }
    }
  } catch {
    // sitemap取得失敗は正常ケース
  }
}

// ============================================================
// ホームページリンククロール
// ============================================================
async function crawlHomepageLinks(
  browser: Browser,
  siteUrl: string,
  origin: string,
): Promise<string[]> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });

  try {
    const page = await context.newPage();
    // 画像・フォント・メディア・CSSをブロックしてメモリ節約
    await page.route("**/*", (route) => {
      const type = route.request().resourceType();
      if (["image", "media", "font", "stylesheet"].includes(type)) {
        return route.abort();
      }
      return route.continue();
    });
    await page.goto(siteUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);

    const hrefs = await page.evaluate(() => {
      const anchors = document.querySelectorAll("a[href]");
      return Array.from(anchors).map((a) => (a as HTMLAnchorElement).href);
    });

    // 同一オリジンのURLのみ、フラグメント・クエリを除去して重複排除
    const seen = new Set<string>();
    const result: string[] = [];
    for (const href of hrefs) {
      try {
        const parsed = new URL(href);
        if (parsed.origin !== origin) continue;
        // フラグメント・クエリパラメータを除去
        const clean = `${parsed.origin}${parsed.pathname}`;
        if (!seen.has(clean)) {
          seen.add(clean);
          result.push(clean);
        }
      } catch {
        // 不正なURLは無視
      }
    }

    return result;
  } finally {
    await context.close();
  }
}

// ============================================================
// robots.txt Disallow チェック
// ============================================================
function isDisallowed(
  url: string,
  origin: string,
  disallowRules: string[],
): boolean {
  const path = url.slice(origin.length);
  return disallowRules.some((rule) => path.startsWith(rule));
}

// ============================================================
// URLパス → ページ種別分類
// ============================================================
function classifyPageType(url: string): PageType {
  try {
    let pathname = new URL(url).pathname;
    // ロケールプレフィックスを除去（/en/, /ja/, /zh-cn/ 等）
    pathname = pathname.replace(/^\/[a-z]{2}(-[a-z]{2})?\//i, "/");
    for (const { pattern, pageType } of PATH_PATTERNS) {
      if (pattern.test(pathname)) {
        return pageType;
      }
    }
  } catch {
    // パース不能
  }
  return "その他・未分類";
}

// ============================================================
// サブページ選択ロジック
// ============================================================
function selectSubpages(
  classified: { url: string; pageType: PageType }[],
  existingUrls: Set<string>,
): { url: string; pageType: PageType }[] {
  // 既存URLと重複するものを除外（UNIQUE制約: site_id, page_url）
  const candidates = classified.filter(
    (item) => !existingUrls.has(item.url),
  );

  // 認識済みページ種別（その他以外）を優先
  const recognized: { url: string; pageType: PageType }[] = [];
  const unrecognized: { url: string; pageType: PageType }[] = [];

  // 認識済みはページ種別ごとに1件のみ選択（多様性優先）
  const selectedTypes = new Set<string>();

  for (const item of candidates) {
    if (item.pageType !== "その他・未分類") {
      if (!selectedTypes.has(item.pageType)) {
        selectedTypes.add(item.pageType);
        recognized.push(item);
      }
    } else {
      unrecognized.push(item);
    }
  }

  // 認識済みから先に埋め、残り枠を未認識（短いパス優先）で埋める
  const result = [...recognized];
  const remaining = MAX_SUBPAGES - result.length;

  if (remaining > 0 && unrecognized.length > 0) {
    unrecognized.sort((a, b) => {
      const pathA = new URL(a.url).pathname;
      const pathB = new URL(b.url).pathname;
      return pathA.length - pathB.length;
    });
    result.push(...unrecognized.slice(0, remaining));
  }

  return result.slice(0, MAX_SUBPAGES);
}

// ============================================================
// ユーティリティ
// ============================================================
function normalizeUrl(url: string): string {
  return url.toLowerCase().replace(/\/$/, "").replace(/^https?:\/\//, "");
}

// ============================================================
// 実行
// ============================================================
main().catch((err) => {
  console.error("[discover] 予期しないエラー:", err);
  process.exit(1);
});
