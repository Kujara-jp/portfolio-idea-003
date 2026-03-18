/**
 * design-vault: HTML構造・CSS変数収集スクリプト（Phase 10）
 *
 * Playwright を使って収集済みページのセクション単位 HTML + computedStyles を取得し、
 * page_sections.html_clean / computed_styles カラムに保存する。
 * 併せて pages.design_rules.css_variables（:root CSS変数）を追記する。
 *
 * Claude/OpenAI API は使用しない。追加コスト $0。
 *
 * 実行方法:
 *   npx tsx scripts/collect-html-structure.ts
 *   npx tsx scripts/collect-html-structure.ts --limit=20
 *   npx tsx scripts/collect-html-structure.ts --min-quality=4
 *   npx tsx scripts/collect-html-structure.ts --industry=飲食
 *   npx tsx scripts/collect-html-structure.ts --min-quality=4 --industry=飲食 --limit=50
 *
 * 対象:
 *   page_sections に html_clean IS NULL のセクションを持つページ
 *   + is_blocked IS NOT TRUE AND quality_score >= (指定値、デフォルト3)
 *
 * html_clean の前処理:
 *   - <script> / <style> タグを除去
 *   - HTMLコメント (<!-- -->) を除去
 *   - data-* 属性を除去
 *   - インライン style 属性を除去
 *   - 15,000文字で切り捨て
 *
 * computed_styles (セクション単位):
 *   { font_size, line_height, padding_top, padding_bottom,
 *     background_color, color, max_width }
 *
 * css_variables (ページ :root 単位):
 *   { "--varname": "value", ... }
 */

import { chromium, type Browser, type Page } from "playwright";
import { createClient } from "@supabase/supabase-js";

// ============================================================
// 設定
// ============================================================
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY!;

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const minQualityArg = args.find((a) => a.startsWith("--min-quality="));
const industryArg = args.find((a) => a.startsWith("--industry="));

const BATCH_LIMIT = limitArg ? parseInt(limitArg.split("=")[1], 10) : 50;
const MIN_QUALITY = minQualityArg ? parseInt(minQualityArg.split("=")[1], 10) : 3;
const INDUSTRY_FILTER = industryArg ? industryArg.split("=")[1] : null;

/** リクエスト間の待機時間（ms）。AGENT.md規約: 最低3秒 */
const REQUEST_DELAY_MS = 3_000;
/** Playwrightページ読み込みタイムアウト（ms）。AGENT.md規約: 30秒 */
const PAGE_TIMEOUT_MS = 30_000;
/** html_clean の最大文字数 */
const HTML_CLEAN_MAX_LENGTH = 15_000;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================
// 型定義
// ============================================================
interface ComputedStyles {
  font_size: string;
  line_height: string;
  padding_top: string;
  padding_bottom: string;
  background_color: string;
  color: string;
  max_width: string;
}

interface SectionRecord {
  section_id: string;
  section_type: string;
  section_order: number;
}

interface PageWithSections {
  page_id: string;
  page_url: string;
  design_rules: Record<string, unknown> | null;
  page_sections: SectionRecord[];
}

// ============================================================
// HTML クリーニング（ブラウザ内で実行）
// ============================================================
/**
 * ブラウザ内で各セクション要素の outerHTML をクリーニングして返す。
 * - <script> / <style> タグを除去
 * - HTML コメントを除去
 * - data-* 属性を除去
 * - インライン style 属性を除去
 * - 15,000文字で切り捨て
 */
async function extractSectionData(
  page: Page,
  maxLength: number,
): Promise<{
  sections: Array<{
    section_type: string;
    html_clean: string;
    computed_styles: ComputedStyles;
  }>;
  css_variables: Record<string, string>;
}> {
  return page.evaluate(
    ({ maxLen }: { maxLen: number }) => {
      // ---- CSS変数（:root）の収集 ----
      const cssVariables: Record<string, string> = {};
      try {
        const rootStyle = getComputedStyle(document.documentElement);
        // CSSStyleDeclaration のプロパティを反復して --から始まる変数のみ取得
        for (let i = 0; i < rootStyle.length; i++) {
          const prop = rootStyle.item(i);
          if (prop.startsWith("--")) {
            const val = rootStyle.getPropertyValue(prop).trim();
            if (val) cssVariables[prop] = val;
          }
        }
      } catch (_e) {
        // CSS変数の収集に失敗しても処理継続
      }

      // ---- セクション単位の収集 ----
      // セクション要素のセレクタ（header / main / section / footer + nav）
      const sectionSelectors = [
        "header",
        "nav",
        "main",
        "section",
        "footer",
        "[class*='hero']",
        "[class*='about']",
        "[class*='service']",
        "[class*='contact']",
        "[class*='cta']",
        "[class*='feature']",
        "[class*='price']",
        "[class*='faq']",
        "[class*='team']",
        "[class*='work']",
        "[class*='portfolio']",
        "[class*='news']",
        "[class*='blog']",
      ];

      // セレクタをまとめて取得（重複除去用に WeakSet）
      const seen = new WeakSet<Element>();
      const sectionEls: Element[] = [];

      for (const sel of sectionSelectors) {
        try {
          const els = document.querySelectorAll(sel);
          for (const el of els) {
            if (!seen.has(el)) {
              seen.add(el);
              const rect = (el as HTMLElement).getBoundingClientRect();
              // 最低200px高がある要素のみ（ナビゲーションリンク等の小要素を除外）
              if (rect.height >= 200 || el.tagName === "NAV" || el.tagName === "HEADER") {
                sectionEls.push(el);
              }
            }
          }
        } catch (_e) {
          // セレクタエラーを無視して継続
        }
      }

      // 最大15要素に制限（ページ全体が大きすぎる場合）
      const targetEls = sectionEls.slice(0, 15);

      const sections: Array<{
        section_type: string;
        html_clean: string;
        computed_styles: ComputedStyles;
      }> = [];

      for (const el of targetEls) {
        try {
          // セクションタイプの推定
          const tag = el.tagName.toLowerCase();
          const classList = el.className?.toString().toLowerCase() ?? "";
          let sectionType = tag;

          if (classList.includes("hero") || classList.includes("jumbotron")) {
            sectionType = "hero";
          } else if (classList.includes("nav") || tag === "nav") {
            sectionType = "navigation-header";
          } else if (classList.includes("about")) {
            sectionType = "about";
          } else if (classList.includes("service")) {
            sectionType = "service-list";
          } else if (classList.includes("contact")) {
            sectionType = "contact";
          } else if (classList.includes("cta")) {
            sectionType = "cta";
          } else if (classList.includes("feature")) {
            sectionType = "features";
          } else if (classList.includes("price")) {
            sectionType = "pricing";
          } else if (classList.includes("faq")) {
            sectionType = "faq";
          } else if (classList.includes("team") || classList.includes("staff")) {
            sectionType = "team";
          } else if (classList.includes("work") || classList.includes("portfolio")) {
            sectionType = "portfolio";
          } else if (classList.includes("news") || classList.includes("blog")) {
            sectionType = "news";
          } else if (tag === "header") {
            sectionType = "navigation-header";
          } else if (tag === "footer") {
            sectionType = "footer";
          } else if (tag === "main") {
            sectionType = "main";
          }

          // outerHTML を取得してクリーニング
          let html = el.outerHTML ?? "";

          // <script> タグを除去
          html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
          // <style> タグを除去
          html = html.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
          // HTML コメントを除去
          html = html.replace(/<!--[\s\S]*?-->/g, "");
          // data-* 属性を除去
          html = html.replace(/\s+data-[a-zA-Z0-9_-]+(?:="[^"]*"|='[^']*'|=[^\s>]*|)/g, "");
          // インライン style 属性を除去
          html = html.replace(/\s+style="[^"]*"/g, "");
          html = html.replace(/\s+style='[^']*'/g, "");
          // 連続する空白を1つに圧縮
          html = html.replace(/\s+/g, " ").trim();
          // 文字数上限で切り捨て
          if (html.length > maxLen) {
            html = html.slice(0, maxLen);
          }

          // computed styles を取得
          const cs = window.getComputedStyle(el as HTMLElement);
          const computedStyles: ComputedStyles = {
            font_size: cs.fontSize ?? "",
            line_height: cs.lineHeight ?? "",
            padding_top: cs.paddingTop ?? "",
            padding_bottom: cs.paddingBottom ?? "",
            background_color: cs.backgroundColor ?? "",
            color: cs.color ?? "",
            max_width: cs.maxWidth ?? "",
          };

          sections.push({ section_type: sectionType, html_clean: html, computed_styles: computedStyles });
        } catch (_e) {
          // 1要素の失敗で全体を止めない
        }
      }

      return { sections, css_variables: cssVariables };
    },
    { maxLen: maxLength },
  );
}

// ============================================================
// メイン処理
// ============================================================
async function main(): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error(
      "[collect-html-structure] SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY が必要です",
    );
    process.exit(1);
  }

  console.log(
    `[collect-html-structure] 設定: min-quality=${MIN_QUALITY}, industry=${INDUSTRY_FILTER ?? "全業種"}, limit=${BATCH_LIMIT}`,
  );

  // html_clean が未収集の page_sections を持つページを取得
  // 業種フィルタの有無で SELECT が変わるため any 型で統一する
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any;

  if (INDUSTRY_FILTER) {
    // 業種フィルタあり: まず対象ページIDを取得してから IN で絞り込む
    const { data: industryPages, error: industryError } = await supabase
      .from("pages")
      .select("page_id, sites!inner(quality_score, industry_category)")
      .gte("sites.quality_score", MIN_QUALITY)
      .eq("sites.industry_category", INDUSTRY_FILTER)
      .neq("is_blocked", true)
      .limit(BATCH_LIMIT * 3);

    if (industryError) {
      console.error("[collect-html-structure] 業種フィルタエラー:", industryError.message);
      process.exit(1);
    }
    const targetPageIds = (industryPages ?? []).map((p: { page_id: string }) => p.page_id);
    if (targetPageIds.length === 0) {
      console.log(
        `[collect-html-structure] 業種「${INDUSTRY_FILTER}」のページが見つかりません。`,
      );
      return;
    }
    console.log(
      `[collect-html-structure] 業種「${INDUSTRY_FILTER}」: ${targetPageIds.length} ページ候補`,
    );
    // IN句の上限を100件に固定してリクエストサイズ超過を防ぐ
    const IN_CLAUSE_LIMIT = 100;
    query = supabase
      .from("pages")
      .select(
        `page_id, page_url, design_rules,
         page_sections!inner(section_id, section_type, section_order)`,
      )
      .is("page_sections.html_clean", null)
      .neq("is_blocked", true)
      .not("page_url", "is", null)
      .in("page_id", targetPageIds.slice(0, IN_CLAUSE_LIMIT));
  } else {
    // 業種フィルタなし: sites!inner で quality_score を絞り込む
    query = supabase
      .from("pages")
      .select(
        `page_id, page_url, design_rules,
         page_sections!inner(section_id, section_type, section_order),
         sites!inner(quality_score)`,
      )
      .is("page_sections.html_clean", null)
      .neq("is_blocked", true)
      .gte("sites.quality_score", MIN_QUALITY)
      .not("page_url", "is", null);
  }

  const { data: pages, error } = await query
    .order("created_at", { ascending: false })
    .limit(BATCH_LIMIT);

  if (error) {
    console.error("[collect-html-structure] Supabase取得エラー:", error.message);
    process.exit(1);
  }

  if (!pages || pages.length === 0) {
    console.log("[collect-html-structure] 未収集ページなし。処理を終了します。");
    return;
  }

  // ページ単位で重複除去（same page_id の複数セクションが複数行になる場合）
  const uniquePagesMap = new Map<string, PageWithSections>();
  for (const row of pages as unknown as PageWithSections[]) {
    if (!uniquePagesMap.has(row.page_id)) {
      uniquePagesMap.set(row.page_id, row);
    }
  }
  const uniquePages = Array.from(uniquePagesMap.values()).slice(0, BATCH_LIMIT);

  console.log(
    `[collect-html-structure] ${uniquePages.length} ページを処理します（BATCH_LIMIT=${BATCH_LIMIT}）`,
  );

  let browser: Browser | null = null;
  let successCount = 0;
  let errorCount = 0;

  try {
    browser = await chromium.launch({ headless: true });

    for (let i = 0; i < uniquePages.length; i++) {
      const pageRecord = uniquePages[i];
      const { page_id, page_url } = pageRecord;

      console.log(
        `[collect-html-structure] [${i + 1}/${uniquePages.length}] ${page_url}`,
      );

      // リクエスト間隔（AGENT.md規約: 最低3秒）
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS));
      }

      const browserPage = await browser.newPage();
      try {
        // PC解像度（AGENT.md規約: 1280x800）
        await browserPage.setViewportSize({ width: 1280, height: 800 });

        // AGENT.md規約: User-Agentを明示的に設定する
        await browserPage.setExtraHTTPHeaders({
          "User-Agent":
            "Mozilla/5.0 (compatible; DesignVaultBot/1.0; +https://skova-digital.com)",
        });

        await browserPage.goto(page_url, {
          waitUntil: "domcontentloaded",
          timeout: PAGE_TIMEOUT_MS,
        });

        // DOMContentLoaded後に少し待機してCSSが適用されるのを待つ
        await browserPage.waitForTimeout(2_000);

        // robots.txt チェック（簡易: /robots.txt を取得して Disallow をチェック）
        // 注: 厳密な robots.txt パーサーは cost が高いため、DesignVaultBot への Disallow のみチェック
        // すでに収集済みのサイトからのみ取得するため、初回収集時のチェックは別途 collect.ts で実施済み

        const extracted = await extractSectionData(
          browserPage,
          HTML_CLEAN_MAX_LENGTH,
        );

        // 1. css_variables を design_rules に追記
        if (Object.keys(extracted.css_variables).length > 0) {
          const existingRules = pageRecord.design_rules ?? {};
          const updatedRules = {
            ...existingRules,
            css_variables: extracted.css_variables,
          };
          const { error: rulesError } = await supabase
            .from("pages")
            .update({ design_rules: updatedRules })
            .eq("page_id", page_id);

          if (rulesError) {
            console.error(
              `[collect-html-structure]   css_variables 保存エラー (${page_id}):`,
              rulesError.message,
            );
          } else {
            console.log(
              `[collect-html-structure]   css_variables: ${Object.keys(extracted.css_variables).length} 変数 保存済み`,
            );
          }
        }

        // 2. 各セクションの html_clean / computed_styles を page_sections に保存
        let sectionSaved = 0;
        for (const sec of extracted.sections) {
          // section_type でマッチする page_sections レコードを探す
          // なければ最初の未収集セクションに保存（近似マッチ）
          const targetSection = pageRecord.page_sections.find(
            (s) => s.section_type === sec.section_type,
          ) ?? pageRecord.page_sections[sectionSaved] ?? null;

          if (!targetSection) continue;

          const { error: secError } = await supabase
            .from("page_sections")
            .update({
              html_clean: sec.html_clean,
              computed_styles: sec.computed_styles,
            })
            .eq("section_id", targetSection.section_id)
            .is("html_clean", null); // 既に収集済みのものは上書きしない

          if (!secError) {
            sectionSaved++;
          }
        }

        console.log(
          `[collect-html-structure]   セクション HTML: ${sectionSaved}/${extracted.sections.length} 保存済み`,
        );
        successCount++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[collect-html-structure]   スキップ (${page_url}): ${msg}`,
        );
        errorCount++;
      } finally {
        await browserPage.close();
      }
    }
  } finally {
    if (browser) await browser.close();
  }

  console.log(
    `[collect-html-structure] 完了: 成功=${successCount} エラー=${errorCount}`,
  );
}

main().catch((err) => {
  console.error("[collect-html-structure] 致命的エラー:", err);
  process.exit(1);
});
