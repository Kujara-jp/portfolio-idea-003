/**
 * design-vault: URLハーベスタースクリプト
 * 以下の2ソースからURLを収集して collect_queue に投入する
 *   A. Awwwards ギャラリー（高品質サイト・無料）
 *   B. CSS Design Awards ギャラリー（高品質サイト・無料）
 *   C. Tavily 検索（日本サイト補充・無料枠内）
 *      ※ クエリグループをローテーションして月1,000リクエスト枠内に収める
 *
 * 実行方法:
 *   npx tsx scripts/harvest.ts
 *   npx tsx scripts/harvest.ts --limit=50
 *   npx tsx scripts/harvest.ts --source=awwwards
 *   npx tsx scripts/harvest.ts --source=tavily
 *   npx tsx scripts/harvest.ts --source=tavily --group=2   # グループ指定
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
const TAVILY_QUERY_GROUPS: string[][] = [
  // グループ0: 美容・サロン（Skova Digitalターゲット最優先）
  [
    "ヘアサロン 日本 公式サイト おしゃれ",
    "美容室 公式ホームページ デザイン",
    "エステサロン 日本 公式サイト",
    "ネイルサロン 日本 ホームページ",
    "リラクゼーション スパ 日本 公式",
    "まつ毛エクステ 日本 サロンサイト",
    "美容院 コーポレートサイト 日本",
    "ヘッドスパ 美容系 日本 公式",
  ],

  // グループ1: 飲食・カフェ（Skova Digitalターゲット）
  [
    "カフェ 日本 公式サイト おしゃれ",
    "レストラン 日本 コーポレートサイト",
    "飲食店 ホームページ デザイン 日本",
    "ラーメン店 公式サイト 日本",
    "パン屋 ベーカリー 日本 公式",
    "居酒屋 チェーン 日本 公式サイト",
    "フードブランド 日本 公式ホームページ",
    "カフェチェーン 日本 公式サイト",
  ],

  // グループ2: 不動産・建築（Skova Digitalターゲット）
  [
    "不動産会社 日本 コーポレートサイト",
    "マンション 分譲 日本 公式サイト",
    "住宅メーカー 日本 公式ホームページ",
    "不動産エージェント 日本 企業サイト",
    "建築事務所 日本 ポートフォリオ",
    "リノベーション 日本 公式サイト",
    "不動産投資 日本 企業サイト",
    "工務店 日本 公式ホームページ",
  ],

  // グループ3: 医療・クリニック（Skova Digitalターゲット）
  [
    "クリニック 日本 公式サイト",
    "歯科医院 ホームページ 日本",
    "美容クリニック 日本 公式サイト",
    "整体院 整骨院 日本 公式",
    "皮膚科 クリニック 日本 ホームページ",
    "内科 クリニック 日本 公式",
    "病院 医療法人 日本 コーポレートサイト",
    "ヘルスケア 日本 サービスサイト",
  ],

  // グループ4: SaaS・テック・コーポレート（既存カテゴリ継続）
  [
    "SaaS 日本 公式サイト",
    "スタートアップ 日本 サービスサイト",
    "クラウドサービス 日本 企業サイト",
    "HR テック 日本",
    "デザイン会社 日本 コーポレートサイト",
    "広告代理店 日本 会社サイト",
    "コンサルティング 日本 企業サイト",
    "建築設計 日本 事務所サイト",
  ],

  // グループ5: EC・ブランド・その他
  [
    "ファッション ブランド 日本 公式",
    "コスメ 日本 ブランドサイト",
    "インテリア 日本 EC サイト",
    "食品 日本 ブランド 公式",
    "日本 オンラインメディア サイト",
    "日本 クリエイター プラットフォーム",
    "フィットネス ジム 日本 公式サイト",
    "旅行 観光 日本 企業サイト",
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
      url: canonicalizeUrl(item.url),
      status: "pending",
      priority: item.priority,
      normalized_url: normalizeForDedup(item.url),
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
    `[harvest]   CSSDA:    ${toInsert.filter((u) => u.source === "cssda").length}件`,
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
