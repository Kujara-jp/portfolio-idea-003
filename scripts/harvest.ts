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

  // A. Awwwards スクレイピング
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
// A. Awwwards スクレイピング
// ============================================================
async function harvestAwwwards(
  existingUrls: Set<string>,
): Promise<{ url: string; source: string; priority: number }[]> {
  const results: { url: string; source: string; priority: number }[] = [];

  // Awwwards の nominees ページ（複数ページ）
  const pages = [1, 2, 3, 4, 5];

  for (const page of pages) {
    try {
      const res = await fetch(
        `https://www.awwwards.com/nominees/page/${page}/`,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Accept: "text/html",
          },
        },
      );
      if (!res.ok) {
        console.warn(`[harvest] Awwwards page ${page} 取得失敗: ${res.status}`);
        continue;
      }

      const html = await res.text();

      // サイトURLを抽出（nominee の外部リンク）
      const matches = html.matchAll(
        /href="https?:\/\/(?!www\.awwwards\.com)[^"]+"/g,
      );
      for (const match of matches) {
        const raw = match[0].replace(/^href="/, "").replace(/"$/, "");
        try {
          const parsed = new URL(raw);
          // トップドメインのみ取得
          const normalized = `${parsed.protocol}//${parsed.hostname}`;
          if (!existingUrls.has(normalizeUrl(normalized))) {
            existingUrls.add(normalizeUrl(normalized));
            results.push({ url: normalized, source: "awwwards", priority: 1 });
          }
        } catch {
          // URL パース失敗は無視
        }
      }

      // レート制限対策
      await sleep(1000);
    } catch (err) {
      console.warn(`[harvest] Awwwards page ${page} エラー:`, err);
    }
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
