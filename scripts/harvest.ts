/**
 * design-vault: URLハーベスタースクリプト
 * 以下のソースからURLを収集して collect_queue に投入する
 *   A. Awwwards ギャラリー（高品質サイト・無料）
 *   B. CSS Design Awards ギャラリー（高品質サイト・無料）
 *   C. Tavily 検索（日本サイト補充・無料枠内）
 *      ※ クエリグループをローテーションして月1,000リクエスト枠内に収める
 *   D. WebDesignClip（国内ギャラリー・Skova優先業種カテゴリ）
 *   E. I/O 3000（国内ギャラリー・全件ページネーション）
 *   F. MUUUUU.ORG（国内ギャラリー・全件ページネーション）
 *   G. SANKOU!（国内ギャラリー・Skova優先業種カテゴリ）
 *
 * 実行方法:
 *   npx tsx scripts/harvest.ts
 *   npx tsx scripts/harvest.ts --limit=50
 *   npx tsx scripts/harvest.ts --source=awwwards
 *   npx tsx scripts/harvest.ts --source=tavily
 *   npx tsx scripts/harvest.ts --source=tavily --group=2   # グループ指定
 *   npx tsx scripts/harvest.ts --source=webdesignclip
 *   npx tsx scripts/harvest.ts --source=io3000
 *   npx tsx scripts/harvest.ts --source=muuuuu
 *   npx tsx scripts/harvest.ts --source=sankou
 *   npx tsx scripts/harvest.ts --source=jp-galleries    # 国内4ギャラリー一括
 */

import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { canonicalizeUrl, normalizeForDedup } from "./lib/normalize";

// ============================================================
// 設定
// ============================================================
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY!;

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const HARVEST_LIMIT = limitArg ? parseInt(limitArg.split("=")[1]) : 50;
const sourceArg = args.find((a) => a.startsWith("--source="));
const SOURCE = sourceArg ? sourceArg.split("=")[1] : "all";
const groupArg = args.find((a) => a.startsWith("--group="));

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 除外ドメイン（SNS・ポータル・大手プラットフォーム）
// ギャラリースクレイピング時のリンクフィルタ + Tavily除外に使用
const SNS_DOMAINS = [
  // SNS
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
  // グルメ・予約ポータル（事業者サイトではないため除外）
  "tabelog.com",
  "hotpepper.jp",
  "jalan.net",
  "travel.rakuten.co.jp",
  "ikyu.com",
  "yelp.com",
  "tripadvisor.com",
  "tripadvisor.jp",
  "retty.me",
  "gurunavi.com",
  // 大手ECプラットフォーム
  "amazon.co.jp",
  "amazon.com",
  "rakuten.co.jp",
  "mercari.com",
  "yahoo.co.jp",
  "shopping.yahoo.co.jp",
  // ニュース・メディア・ポータル
  "wikipedia.org",
  "news.yahoo.co.jp",
  "mynavi.jp",
  "type.jp",
  "doda.jp",
  "recruit.co.jp",
  // 地図・検索
  "maps.google.com",
  "google.com",
  "apple.com",
  // クラウドソーシング・フリマ
  "lancers.jp",
  "crowdworks.jp",
  "coconala.com",
  // 予約・集客プラットフォーム
  "minpaku.com",
  "airbnb.com",
  "booking.com",
  "hotels.com",
  "beauty.hotpepper.jp",
  "eparkbeauty.com",
  "b-post.jp",
  // ブログ・CMS（純粋な事業者サイトではないため）
  "ameblo.jp",
  "note.com",
  "wix.com",
  "jimdo.com",
  "stores.jp",
  "base.shop",
];

// ============================================================
// Tavily 検索クエリグループ（Skova Digital ターゲット業種優先）
//
// ローテーション戦略:
//   グループ数: 6グループ × 各8クエリ = 計48クエリ
//   1回の実行: 1グループ（8クエリ）のみ処理
//   月間使用量: 8クエリ × 4回/日 × 30日 = 960リクエスト（無料枠1,000以内）
//   全クエリ一周: 6グループ ÷ 4回/日 = 1.5日サイクル
//
// グループ選択:
//   --group=N 指定時は固定
//   未指定時は UTC エポック時間（6h単位のサイクル数）mod 6 で自動ローテーション
// ============================================================
// ============================================================
// 収集クエリ改訂方針（Phase A/B 方向修正）
//
// 問題: 「公式サイト」「コーポレートサイト」「チェーン」キーワードが
//        大手企業・チェーン店を引き寄せ、Skovaターゲット（中小・個人）と
//        乖離していた。
//
// 修正: 個人・地域密着・中小規模を引き寄せるキーワードに転換
//   NG: 「公式サイト」「コーポレートサイト」「チェーン」「上場企業」
//   OK: 「地元」「おしゃれ」「こだわり」「個人経営」「スタジオ」「一軒家」
// ============================================================
const TAVILY_QUERY_GROUPS: string[][] = [
  // グループ0: 美容・サロン（Skova Digitalターゲット最優先・個人〜中小規模）
  [
    "ヘアサロン おしゃれ 日本 個人 ホームページ",
    "美容室 こだわり 地元 日本 デザイン",
    "エステサロン プライベート 日本 サイト",
    "ネイルサロン 自宅 一人 日本 ホームページ",
    "リラクゼーション スパ 個人経営 日本",
    "まつ毛エクステ プライベートサロン 日本",
    "ヘアサロン 隠れ家 こだわり 日本",
    "ヘッドスパ 地域密着 日本 小規模",
  ],

  // グループ1: 飲食・カフェ（個人〜小規模店舗限定）
  [
    "カフェ 個人経営 日本 おしゃれ",
    "自家焙煎 コーヒー 日本 小規模 店舗",
    "ベーカリー パン屋 こだわり 日本 地元",
    "ラーメン店 個人 日本 店舗サイト",
    "居酒屋 個人経営 日本 地域密着",
    "レストラン ビストロ 日本 一軒家 こだわり",
    "カフェ スペシャルティコーヒー 日本 スタンド",
    "飲食店 小さい お店 日本 ホームページ",
  ],

  // グループ2: 医療・クリニック（地域密着・個人クリニック）
  [
    "歯科医院 地域密着 日本 個人",
    "クリニック かかりつけ医 日本 小規模",
    "整体院 個人 日本 ホームページ",
    "鍼灸院 個人経営 日本",
    "整骨院 地元 日本 サイト",
    "皮膚科 クリニック 個人 日本",
    "内科 個人医院 地域 日本",
    "ヘルスケア スタジオ 日本 小規模",
  ],

  // グループ3: スポーツ・士業・フィットネス（個人〜中規模）
  [
    "ヨガスタジオ 個人 日本 おしゃれ",
    "ピラティス スタジオ 日本 プライベート",
    "パーソナルトレーニング ジム 個人 日本",
    "税理士 個人事務所 日本 ホームページ",
    "行政書士 個人 日本 サイト",
    "弁護士 個人事務所 日本 ホームページ",
    "経営コンサルタント フリーランス 日本",
    "士業 個人 日本 こだわりサイト",
  ],

  // グループ4: IT・テック（スタートアップ・個人・中小SaaS）
  [
    "スタートアップ 日本 小規模 サービスサイト",
    "個人開発 SaaS 日本 ツール",
    "フリーランス エンジニア 日本 ポートフォリオ",
    "中小企業 BtoBツール 日本",
    "デザイン会社 小規模 日本 スタジオ",
    "Web制作 個人 日本 事務所",
    "コンサルタント 個人 日本 サービスサイト",
    "建築設計 個人 事務所 日本",
  ],

  // グループ5: 不動産・その他（中小・地域密着）
  [
    "不動産 地域密着 日本 中小",
    "工務店 地元 日本 小規模",
    "リノベーション 個人 日本 施工例",
    "ファッション セレクトショップ 日本 個人",
    "インテリア 雑貨 個人経営 日本",
    "旅行 観光 地域 日本 小規模",
    "フィットネス 個人スタジオ 日本",
    "教室 スクール 個人 日本 こだわり",
  ],
];

/** Tavily クエリグループのインデックスを自動選択（UTC時間ベースのローテーション） */
function selectQueryGroup(): number {
  if (groupArg) {
    const n = parseInt(groupArg.split("=")[1]);
    if (!isNaN(n) && n >= 0 && n < TAVILY_QUERY_GROUPS.length) return n;
  }
  // UTC エポック秒を6時間（21,600秒）で割ったサイクル数をグループ数で割った余り
  const cycleIndex = Math.floor(Date.now() / 1000 / 21_600);
  return cycleIndex % TAVILY_QUERY_GROUPS.length;
}

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

  // B. CSS Design Awards スクレイピング（Playwright）
  if (SOURCE === "all" || SOURCE === "cssda") {
    const cssdaUrls = await harvestCSSDA(existingUrls);
    collectedUrls.push(...cssdaUrls);
    console.log(`[harvest] CSSDA: ${cssdaUrls.length}件取得`);
  }

  // C. Tavily 検索（日本サイト・グループローテーション）
  if (SOURCE === "all" || SOURCE === "tavily") {
    const groupIndex = selectQueryGroup();
    const tavilyUrls = await harvestTavily(existingUrls, groupIndex);
    collectedUrls.push(...tavilyUrls);
    console.log(`[harvest] Tavily: ${tavilyUrls.length}件取得（グループ${groupIndex}）`);
  }

  // D. WebDesignClip（国内ギャラリー・Skova優先業種カテゴリ）
  if (SOURCE === "all" || SOURCE === "jp-galleries" || SOURCE === "webdesignclip") {
    const wdcUrls = await harvestWebDesignClip(existingUrls);
    collectedUrls.push(...wdcUrls);
    console.log(`[harvest] WebDesignClip: ${wdcUrls.length}件取得`);
  }

  // E. I/O 3000（国内ギャラリー・全件ページネーション）
  if (SOURCE === "all" || SOURCE === "jp-galleries" || SOURCE === "io3000") {
    const io3000Urls = await harvestIo3000(existingUrls);
    collectedUrls.push(...io3000Urls);
    console.log(`[harvest] I/O 3000: ${io3000Urls.length}件取得`);
  }

  // F. MUUUUU.ORG（国内ギャラリー・全件ページネーション）
  if (SOURCE === "all" || SOURCE === "jp-galleries" || SOURCE === "muuuuu") {
    const muuuuuUrls = await harvestMuuuuu(existingUrls);
    collectedUrls.push(...muuuuuUrls);
    console.log(`[harvest] MUUUUU.ORG: ${muuuuuUrls.length}件取得`);
  }

  // G. SANKOU!（国内ギャラリー・Skova優先業種カテゴリ）
  if (SOURCE === "all" || SOURCE === "jp-galleries" || SOURCE === "sankou") {
    const sankouUrls = await harvestSankou(existingUrls);
    collectedUrls.push(...sankouUrls);
    console.log(`[harvest] SANKOU!: ${sankouUrls.length}件取得`);
  }

  if (collectedUrls.length === 0) {
    console.log("[harvest] 新規URLなし。終了します。");
    return;
  }

  // 上限まで絞る
  const toInsert = collectedUrls.slice(0, HARVEST_LIMIT);
  console.log(`[harvest] ${toInsert.length}件を collect_queue に投入します`);

  // collect_queue に INSERT（既登録URLは重複無視）
  const { error } = await supabase.from("collect_queue").upsert(
    toInsert.map((item) => ({
      url: canonicalizeUrl(item.url),
      status: "pending",
      priority: item.priority,
      normalized_url: normalizeForDedup(item.url),
    })),
    { onConflict: "url", ignoreDuplicates: true },
  );

  if (error) {
    console.error("[harvest] INSERT エラー:", error.message);
    process.exit(1);
  }

  console.log(`\n[harvest] ✅ ${toInsert.length}件投入完了`);
  const summarySources = ["awwwards", "cssda", "tavily", "webdesignclip", "io3000", "muuuuu", "sankou"];
  for (const src of summarySources) {
    const count = toInsert.filter((u) => u.source === src).length;
    if (count > 0) {
      console.log(`[harvest]   ${src.padEnd(14)}: ${count}件`);
    }
  }
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

  for (const s of sites ?? []) urls.add(normalizeForDedup(s.url));
  for (const q of queue ?? []) urls.add(normalizeForDedup(q.url));

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
      return Array.from(new Set(links));
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

        if (externalUrl && !existingUrls.has(normalizeForDedup(externalUrl))) {
          existingUrls.add(normalizeForDedup(externalUrl));
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
// B. CSS Design Awards スクレイピング（Playwright版）
//    /website-gallery から外部URLを収集
// ============================================================
async function harvestCSSDA(
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

    console.log("[harvest] CSSDA: ギャラリーページからURL収集中...");
    await page.goto("https://www.cssdesignawards.com/website-gallery", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // スクロールしてlazy load分を読み込む
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollBy(0, 1500));
      await sleep(1500);
    }

    // 各サイトカードからURLを収集
    const siteUrls = await page.evaluate((snsDomains: string[]) => {
      const links = Array.from(document.querySelectorAll("a"))
        .map((a) => a.href)
        .filter(
          (h) =>
            h.startsWith("http") &&
            !h.includes("cssdesignawards.com") &&
            !snsDomains.some((sns) => h.includes(sns)),
        );

      // ホスト名で重複排除
      const seen = new Set<string>();
      const unique: string[] = [];
      for (const link of links) {
        try {
          const parsed = new URL(link);
          const host = parsed.hostname.toLowerCase();
          if (!seen.has(host)) {
            seen.add(host);
            unique.push(`${parsed.protocol}//${parsed.hostname}`);
          }
        } catch {
          // skip
        }
      }
      return unique;
    }, SNS_DOMAINS);

    console.log(`[harvest] CSSDA: ${siteUrls.length}件のURL取得`);

    for (const url of siteUrls.slice(0, 30)) {
      if (!existingUrls.has(normalizeForDedup(url))) {
        existingUrls.add(normalizeForDedup(url));
        results.push({ url, source: "cssda", priority: 1 });
      }
    }
  } catch (err) {
    console.warn("[harvest] CSSDA エラー:", err);
  } finally {
    await browser.close();
  }

  return results;
}

// ============================================================
// C. Tavily 検索（日本サイト・グループローテーション）
//
// groupIndex: 0〜5 のグループインデックス
//   各グループ8クエリ × 4回/日 = 32リクエスト/日 × 30日 = 960/月（無料枠内）
// ============================================================
async function harvestTavily(
  existingUrls: Set<string>,
  groupIndex: number,
): Promise<{ url: string; source: string; priority: number }[]> {
  const results: { url: string; source: string; priority: number }[] = [];
  const queries = TAVILY_QUERY_GROUPS[groupIndex] ?? TAVILY_QUERY_GROUPS[0];

  console.log(
    `[harvest] Tavily: グループ${groupIndex} (${queries.length}クエリ) を処理中...`,
  );

  for (const query of queries) {
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
          // SNS_DOMAINS と同期（ポータル・大手プラットフォームを包括除外）
          exclude_domains: SNS_DOMAINS,
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
          if (!existingUrls.has(normalizeForDedup(normalized))) {
            existingUrls.add(normalizeForDedup(normalized));
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
// D. WebDesignClip（国内デザインギャラリー）
//    Skova Digitalターゲット業種に対応するカテゴリページを巡回し
//    aria-label="launch" リンクから元サイトURLを取得する
// ============================================================

/** WebDesignClip の対象カテゴリ（Skova Digitalターゲット業種対応） */
const WDC_CATEGORIES = [
  "beauty",        // 美容・ヘアサロン
  "eat-drink",     // 飲食・カフェ・バー
  "food",          // 食品・フード
  "hospital",      // 医療・クリニック
  "estate",        // 不動産・建築
  "company",       // 企業・コーポレート（中小）
  "sports",        // スポーツ・フィットネス
  "welfare",       // 福祉・介護
  "school",        // 教育・スクール
];

async function harvestWebDesignClip(
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

    for (const category of WDC_CATEGORIES) {
      // 各カテゴリの1〜3ページを巡回
      for (let pageNum = 1; pageNum <= 3; pageNum++) {
        const url =
          pageNum === 1
            ? `https://webdesignclip.com/category/${category}/`
            : `https://webdesignclip.com/category/${category}/page/${pageNum}/`;

        try {
          const res = await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 20000,
          });

          // 404 等でページが存在しない場合はスキップ
          if (!res || res.status() === 404) break;

          // aria-label="launch" のリンクを取得
          const siteUrls = await page.evaluate((snsDomains: string[]) => {
            return Array.from(
              document.querySelectorAll<HTMLAnchorElement>('a[aria-label="launch"]'),
            )
              .map((a) => a.href)
              .filter(
                (h) =>
                  h.startsWith("http") &&
                  !h.includes("webdesignclip.com") &&
                  !snsDomains.some((sns) => h.includes(sns)),
              );
          }, SNS_DOMAINS);

          for (const siteUrl of siteUrls) {
            try {
              const parsed = new URL(siteUrl);
              const normalized = `${parsed.protocol}//${parsed.hostname}`;
              if (!existingUrls.has(normalizeForDedup(normalized))) {
                existingUrls.add(normalizeForDedup(normalized));
                results.push({ url: normalized, source: "webdesignclip", priority: 1 });
              }
            } catch {
              // URL パース失敗は無視
            }
          }

          console.log(
            `[harvest] WebDesignClip /${category}/ page${pageNum}: ${siteUrls.length}件`,
          );
          await sleep(1500);
        } catch (err) {
          console.warn(`[harvest] WebDesignClip ${url} エラー:`, err);
          break;
        }
      }
    }
  } finally {
    await browser.close();
  }

  return results;
}

// ============================================================
// E. I/O 3000（国内デザインギャラリー）
//    トップページ + ページネーション（/?page=N）から
//    class="list-index__target" のリンクで元サイトURLを取得する
// ============================================================

async function harvestIo3000(
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

    // 最大5ページまで巡回（1ページあたり約12件）
    for (let pageNum = 1; pageNum <= 5; pageNum++) {
      const url =
        pageNum === 1
          ? "https://io3000.com/"
          : `https://io3000.com/?page=${pageNum}`;

      try {
        const res = await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 20000,
        });

        if (!res || res.status() === 404) break;

        const siteUrls = await page.evaluate((snsDomains: string[]) => {
          return Array.from(
            document.querySelectorAll<HTMLAnchorElement>(
              'a.list-index__target[target="_blank"]',
            ),
          )
            .map((a) => a.href)
            .filter(
              (h) =>
                h.startsWith("http") &&
                !h.includes("io3000.com") &&
                !snsDomains.some((sns) => h.includes(sns)),
            );
        }, SNS_DOMAINS);

        // セレクタが空なら別パターンも試す
        const fallbackUrls =
          siteUrls.length === 0
            ? await page.evaluate((snsDomains: string[]) => {
                return Array.from(
                  document.querySelectorAll<HTMLAnchorElement>(
                    'a[target="_blank"][rel="noopener"]',
                  ),
                )
                  .map((a) => a.href)
                  .filter(
                    (h) =>
                      h.startsWith("http") &&
                      !h.includes("io3000.com") &&
                      !snsDomains.some((sns) => h.includes(sns)),
                  );
              }, SNS_DOMAINS)
            : [];

        const allUrls = siteUrls.length > 0 ? siteUrls : fallbackUrls;

        for (const siteUrl of allUrls) {
          try {
            const parsed = new URL(siteUrl);
            const normalized = `${parsed.protocol}//${parsed.hostname}`;
            if (!existingUrls.has(normalizeForDedup(normalized))) {
              existingUrls.add(normalizeForDedup(normalized));
              results.push({ url: normalized, source: "io3000", priority: 1 });
            }
          } catch {
            // URL パース失敗は無視
          }
        }

        console.log(`[harvest] I/O 3000 page${pageNum}: ${allUrls.length}件`);
        await sleep(1500);

        // 取得できなければ終端とみなす
        if (allUrls.length === 0) break;
      } catch (err) {
        console.warn(`[harvest] I/O 3000 page${pageNum} エラー:`, err);
        break;
      }
    }
  } finally {
    await browser.close();
  }

  return results;
}

// ============================================================
// F. MUUUUU.ORG（国内デザインギャラリー）
//    トップページ + ページネーションから
//    class="c-post-list__link" のリンクで元サイトURLを取得する
// ============================================================

async function harvestMuuuuu(
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

    // 最大5ページまで巡回（1ページあたり約15件）
    for (let pageNum = 1; pageNum <= 5; pageNum++) {
      const url =
        pageNum === 1
          ? "https://muuuuu.org/"
          : `https://muuuuu.org/page/${pageNum}/`;

      try {
        const res = await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 20000,
        });

        if (!res || res.status() === 404) break;

        const siteUrls = await page.evaluate((snsDomains: string[]) => {
          return Array.from(
            document.querySelectorAll<HTMLAnchorElement>(
              'a.c-post-list__link[target="_blank"]',
            ),
          )
            .map((a) => a.href)
            .filter(
              (h) =>
                h.startsWith("http") &&
                h.trim() !== "" &&
                !h.includes("muuuuu.org") &&
                !snsDomains.some((sns) => h.includes(sns)),
            );
        }, SNS_DOMAINS);

        for (const siteUrl of siteUrls) {
          try {
            const parsed = new URL(siteUrl);
            const normalized = `${parsed.protocol}//${parsed.hostname}`;
            if (!existingUrls.has(normalizeForDedup(normalized))) {
              existingUrls.add(normalizeForDedup(normalized));
              results.push({ url: normalized, source: "muuuuu", priority: 1 });
            }
          } catch {
            // URL パース失敗は無視
          }
        }

        console.log(`[harvest] MUUUUU.ORG page${pageNum}: ${siteUrls.length}件`);
        await sleep(1500);

        if (siteUrls.length === 0) break;
      } catch (err) {
        console.warn(`[harvest] MUUUUU.ORG page${pageNum} エラー:`, err);
        break;
      }
    }
  } finally {
    await browser.close();
  }

  return results;
}

// ============================================================
// G. SANKOU!（国内デザインギャラリー）
//    Skova Digitalターゲット業種に対応するカテゴリページを巡回し
//    target="_blank" rel="noopener" リンクから元サイトURLを取得する
//    ※同じURLが3回出る構造なので重複除去が必須
// ============================================================

/** SANKOU! の対象カテゴリ（Skova Digitalターゲット業種対応） */
const SANKOU_CATEGORIES = [
  "cafe-restaurant-tavern",                            // カフェ・飲食
  "salon",                                             // サロン・美容
  "hospital-clinic-medicalcare-dentist",               // 医療・クリニック
  "beauty-cosmetics-caregoods",                        // 美容・コスメ
  "architecture-construction-realestate-home-garden",  // 不動産・建築
  "cooking-food-beverage",                             // 食品・飲料
  "health-sport",                                      // ヘルス・スポーツ
  "bank-insurance-finance-law",                        // 金融・士業
  "it-internet-media",                                 // IT・Web
  "school-lesson",                                     // 教育・スクール
];

async function harvestSankou(
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

    for (const category of SANKOU_CATEGORIES) {
      // 各カテゴリの1〜3ページを巡回
      for (let pageNum = 1; pageNum <= 3; pageNum++) {
        const url =
          pageNum === 1
            ? `https://sankoudesign.com/category/${category}/`
            : `https://sankoudesign.com/category/${category}/page/${pageNum}/`;

        try {
          const res = await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 20000,
          });

          if (!res || res.status() === 404) break;

          // target="_blank" rel="noopener" のリンクをすべて取得
          // ※同じURLが複数出るため hostname レベルで重複除去する
          const siteUrls = await page.evaluate((snsDomains: string[]) => {
            const seen = new Set<string>();
            const unique: string[] = [];

            for (const a of Array.from(
              document.querySelectorAll<HTMLAnchorElement>(
                'a[target="_blank"][rel="noopener"]',
              ),
            )) {
              const h = a.href;
              if (
                !h.startsWith("http") ||
                h.includes("sankoudesign.com") ||
                snsDomains.some((sns) => h.includes(sns))
              )
                continue;

              try {
                const parsed = new URL(h);
                const host = parsed.hostname.toLowerCase();
                if (!seen.has(host)) {
                  seen.add(host);
                  unique.push(`${parsed.protocol}//${parsed.hostname}`);
                }
              } catch {
                // skip
              }
            }
            return unique;
          }, SNS_DOMAINS);

          for (const siteUrl of siteUrls) {
            if (!existingUrls.has(normalizeForDedup(siteUrl))) {
              existingUrls.add(normalizeForDedup(siteUrl));
              results.push({ url: siteUrl, source: "sankou", priority: 1 });
            }
          }

          console.log(
            `[harvest] SANKOU! /${category}/ page${pageNum}: ${siteUrls.length}件`,
          );
          await sleep(1500);

          if (siteUrls.length === 0) break;
        } catch (err) {
          console.warn(`[harvest] SANKOU! ${url} エラー:`, err);
          break;
        }
      }
    }
  } finally {
    await browser.close();
  }

  return results;
}

// ============================================================
// ユーティリティ
// ============================================================
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
