/**
 * design-vault: HTML/CSS設計ルール収集スクリプト（Phase 9）
 *
 * Playwright を使って収集済みページの計算済みCSSスタイルを取得し、
 * pages.design_rules JSONB カラムに保存する。
 *
 * Claude/OpenAI API は使用しない。追加コスト $0。
 *
 * 実行方法:
 *   npx tsx scripts/collect-design-rules.ts
 *   npx tsx scripts/collect-design-rules.ts --limit=20
 *
 * 対象:
 *   design_rules IS NULL AND is_blocked IS NOT TRUE AND quality_score >= 3
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
const BATCH_LIMIT = limitArg ? parseInt(limitArg.split("=")[1], 10) : 50;

/** リクエスト間の待機時間（ms）。AGENT.md規約: 最低3秒 */
const REQUEST_DELAY_MS = 3_000;
/** Playwrightページ読み込みタイムアウト（ms）。AGENT.md規約: 30秒 */
const PAGE_TIMEOUT_MS = 30_000;
/** getComputedStyle サンプリングの最大要素数 */
const MAX_SAMPLE_ELEMENTS = 300;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================
// 型定義
// ============================================================
interface SpacingRules {
  common_padding: string[];
  common_margin: string[];
  section_gap: string[];
}

interface LayoutRules {
  grid_systems: string[];
  flex_patterns: string[];
  max_widths: string[];
}

interface TypographyRules {
  font_sizes: string[];
  font_weights: string[];
  line_heights: string[];
  font_families: string[];
}

interface ColorRules {
  backgrounds: string[];
  texts: string[];
}

interface DesignRules {
  spacing: SpacingRules;
  layout: LayoutRules;
  typography: TypographyRules;
  colors: ColorRules;
  collected_at: string;
}

interface PageRecord {
  page_id: string;
  page_url: string;
}

// ============================================================
// ユーティリティ: 頻出値を上位N件に絞る
// ============================================================
function topN(values: string[], n: number): string[] {
  const freq: Record<string, number> = {};
  for (const v of values) {
    freq[v] = (freq[v] ?? 0) + 1;
  }
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([v]) => v);
}

// ============================================================
// ユーティリティ: 重複除去して上位N件
// ============================================================
function uniqueTopN(values: string[], n: number): string[] {
  return Array.from(new Set(values)).slice(0, n);
}

// ============================================================
// Playwright: 計算済みCSSスタイルを収集
// ============================================================
async function extractDesignRules(page: Page): Promise<DesignRules> {
  // page.evaluate でブラウザコンテキスト内で DOM + ComputedStyle を解析する。
  // 戻り値はシリアライズ可能な構造のみ使用する。
  const raw = await page.evaluate(
    ({ maxElements }: { maxElements: number }) => {
      // 全可視要素を最大 maxElements 件サンプリング
      const allElements = Array.from(
        document.querySelectorAll(
          "header, main, section, article, div, p, h1, h2, h3, nav, footer, aside, ul, li, a, button, span"
        )
      ).filter((el) => {
        const rect = (el as HTMLElement).getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });

      // 均等サンプリング（全件数 > maxElements の場合）
      const step =
        allElements.length > maxElements
          ? Math.floor(allElements.length / maxElements)
          : 1;
      const sampled = allElements.filter((_, i) => i % step === 0).slice(0, maxElements);

      // 収集バッファ
      const paddingValues: string[] = [];
      const marginValues: string[] = [];
      const sectionGapValues: string[] = [];
      const gridSystems: string[] = [];
      const flexPatterns: string[] = [];
      const maxWidths: string[] = [];
      const fontSizes: string[] = [];
      const fontWeights: string[] = [];
      const lineHeights: string[] = [];
      const fontFamilies: string[] = [];
      const backgrounds: string[] = [];
      const texts: string[] = [];

      for (const el of sampled) {
        const cs = window.getComputedStyle(el as HTMLElement);

        // ---- spacing ----
        // padding（0px 以外のみ収集）
        const pt = cs.paddingTop;
        const pr = cs.paddingRight;
        const pb = cs.paddingBottom;
        const pl = cs.paddingLeft;
        if (pt !== "0px") paddingValues.push(pt);
        if (pr !== "0px") paddingValues.push(pr);
        if (pb !== "0px") paddingValues.push(pb);
        if (pl !== "0px") paddingValues.push(pl);

        // margin（0px 以外のみ）
        const mt = cs.marginTop;
        const mr = cs.marginRight;
        const mb = cs.marginBottom;
        const mlv = cs.marginLeft;
        if (mt !== "0px") marginValues.push(mt);
        if (mr !== "0px") marginValues.push(mr);
        if (mb !== "0px") marginValues.push(mb);
        if (mlv !== "0px") marginValues.push(mlv);

        // セクション間の大きな余白（32px以上）
        const mbNum = parseFloat(mb);
        const mtNum = parseFloat(mt);
        if (!isNaN(mbNum) && mbNum >= 32) sectionGapValues.push(mb);
        if (!isNaN(mtNum) && mtNum >= 32) sectionGapValues.push(mt);
        const pbNum = parseFloat(pb);
        const ptNum = parseFloat(pt);
        if (!isNaN(pbNum) && pbNum >= 32) sectionGapValues.push(pb);
        if (!isNaN(ptNum) && ptNum >= 32) sectionGapValues.push(pt);

        // ---- layout ----
        const disp = cs.display;
        if (disp === "grid") {
          const gtc = cs.gridTemplateColumns;
          if (gtc && gtc !== "none") gridSystems.push(gtc);
        }
        if (disp === "flex" || disp === "inline-flex") {
          const fd = cs.flexDirection;
          if (fd) flexPatterns.push(fd);
        }
        const mw = cs.maxWidth;
        if (mw && mw !== "none" && mw !== "0px") maxWidths.push(mw);

        // ---- typography ----
        const fs = cs.fontSize;
        if (fs) fontSizes.push(fs);
        const fw = cs.fontWeight;
        if (fw) fontWeights.push(fw);
        const lh = cs.lineHeight;
        if (lh && lh !== "normal") lineHeights.push(lh);
        const ff = cs.fontFamily;
        if (ff) {
          // font-family の最初の1ファミリーのみ取得
          const firstFamily = ff.split(",")[0].trim().replace(/^['"]|['"]$/g, "");
          if (firstFamily) fontFamilies.push(firstFamily);
        }

        // ---- colors ----
        const bg = cs.backgroundColor;
        // rgba(0,0,0,0) = transparent は除外
        if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
          backgrounds.push(bg);
        }
        const color = cs.color;
        if (color) texts.push(color);
      }

      return {
        paddingValues,
        marginValues,
        sectionGapValues,
        gridSystems,
        flexPatterns,
        maxWidths,
        fontSizes,
        fontWeights,
        lineHeights,
        fontFamilies,
        backgrounds,
        texts,
      };
    },
    { maxElements: MAX_SAMPLE_ELEMENTS }
  );

  // ブラウザ外でデータ集約処理（頻出値を抽出）
  const designRules: DesignRules = {
    spacing: {
      common_padding: topN(raw.paddingValues, 10),
      common_margin: topN(raw.marginValues, 10),
      section_gap: uniqueTopN(raw.sectionGapValues, 10),
    },
    layout: {
      grid_systems: uniqueTopN(raw.gridSystems, 10),
      flex_patterns: uniqueTopN(raw.flexPatterns, 5),
      max_widths: uniqueTopN(raw.maxWidths, 10),
    },
    typography: {
      font_sizes: topN(raw.fontSizes, 10),
      font_weights: uniqueTopN(raw.fontWeights, 8),
      line_heights: uniqueTopN(raw.lineHeights, 8),
      font_families: uniqueTopN(raw.fontFamilies, 5),
    },
    colors: {
      backgrounds: uniqueTopN(raw.backgrounds, 10),
      texts: uniqueTopN(raw.texts, 10),
    },
    collected_at: new Date().toISOString(),
  };

  return designRules;
}

// ============================================================
// メイン処理
// ============================================================
async function main(): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error(
      "[collect-design-rules] SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY が必要です"
    );
    process.exit(1);
  }

  // 対象ページを取得:
  //   - design_rules IS NULL（未収集）
  //   - is_blocked IS NOT TRUE
  //   - quality_score >= 3（低品質ページを除外）
  //   - page_url IS NOT NULL
  const { data: pages, error } = await supabase
    .from("pages")
    .select("page_id, page_url")
    .is("design_rules", null)
    .neq("is_blocked", true)
    .gte("quality_score", 3)
    .not("page_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(BATCH_LIMIT);

  if (error) {
    console.error("[collect-design-rules] Supabase取得エラー:", error.message);
    process.exit(1);
  }

  if (!pages || pages.length === 0) {
    console.log("[collect-design-rules] 未収集ページなし。処理を終了します。");
    return;
  }

  console.log(
    `[collect-design-rules] ${pages.length} 件のページを処理します（BATCH_LIMIT=${BATCH_LIMIT}）`
  );

  let browser: Browser | null = null;
  let successCount = 0;
  let errorCount = 0;

  try {
    browser = await chromium.launch({ headless: true });

    for (let i = 0; i < pages.length; i++) {
      const pageRecord = pages[i] as PageRecord;
      const { page_id, page_url } = pageRecord;

      console.log(
        `[collect-design-rules] [${i + 1}/${pages.length}] ${page_url}`
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
        await browserPage.waitForTimeout(1_500);

        const designRules = await extractDesignRules(browserPage);

        // Supabase に保存
        const { error: updateError } = await supabase
          .from("pages")
          .update({ design_rules: designRules })
          .eq("page_id", page_id);

        if (updateError) {
          console.error(
            `[collect-design-rules]   保存エラー (${page_id}):`,
            updateError.message
          );
          errorCount++;
        } else {
          console.log(`[collect-design-rules]   完了 → design_rules 保存済み`);
          successCount++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[collect-design-rules]   スキップ (${page_url}): ${msg}`
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
    `[collect-design-rules] 完了: 成功=${successCount} エラー=${errorCount}`
  );
}

main().catch((err) => {
  console.error("[collect-design-rules] 致命的エラー:", err);
  process.exit(1);
});
