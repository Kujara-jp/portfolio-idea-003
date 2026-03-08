/**
 * design-vault: タグ付けスクリプト（Batch API版）
 * スクリーンショットを Claude Vision API に送り、以下を自動タグ付けする
 *   ③ デザイントーン
 *   ④ カラースキーム
 *   ⑤ レイアウトパターン
 *   ⑨ タイポグラフィ詳細
 *   ⑪ ナビゲーション構造
 *   ⑫ コンバージョン設計
 *   ⑳ ビジュアル素材
 *
 * 実行方法:
 *   npx tsx scripts/tag.ts
 *   npx tsx scripts/tag.ts --limit=5
 */

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

// ============================================================
// 設定
// ============================================================
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const BATCH_LIMIT = limitArg ? parseInt(limitArg.split("=")[1]) : 5;

const POLL_INTERVAL_MS = 30_000; // 30秒おきにポーリング
const MAX_WAIT_MS = 25 * 60 * 1000; // 最大25分待機

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// ============================================================
// タグ定義
// ============================================================
const TAG_DEFINITIONS = {
  design_tone: [
    "ミニマル",
    "ボールド",
    "エレガント",
    "プレイフル",
    "コーポレート",
    "テック・近未来",
    "オーガニック・ナチュラル",
    "レトロ・ヴィンテージ",
    "ラグジュアリー",
    "フレンドリー",
    "プロフェッショナル",
    "クリエイティブ",
    "ダーク・エッジー",
    "クリーン・モダン",
    "ウォーム・カジュアル",
  ],
  color_scheme: [
    "ライト背景",
    "ダーク背景",
    "ホワイト中心",
    "ブラック中心",
    "アースカラー",
    "ビビッド・鮮やか",
    "モノクロ",
    "グラデーション",
    "ブルー系",
    "グリーン系",
    "レッド系",
    "パープル系",
    "オレンジ系",
    "ゴールド・シルバー",
  ],
  layout_pattern: [
    "ヒーロー中央",
    "ヒーロー左寄せ",
    "ジグザグ",
    "グリッド",
    "フルスクリーン",
    "カード型",
    "タイムライン",
    "マガジン型",
    "ワンカラム",
    "サイドバー付き",
    "マルチカラム",
    "アシンメトリー",
    "スクロールストーリー",
    "タブ切り替え",
    "モーダル多用",
  ],
  typography: [
    "サンセリフ中心",
    "セリフ中心",
    "ビッグタイポ",
    "スモールテキスト多用",
    "日本語フォント重視",
    "欧文フォント重視",
    "モノスペース使用",
    "ハンドライティング",
    "太字強調",
    "カラーテキスト装飾",
    "細字エレガント",
    "大見出し小本文",
    "テキスト少なめ",
  ],
  navigation: [
    "固定ヘッダー",
    "ハンバーガーメニュー",
    "フルスクリーンメニュー",
    "サイドナビ",
    "ボトムナビ",
    "アンカーリンク",
    "ステップ型",
    "メガメニュー",
    "スクロール連動",
    "フローティングボタン",
  ],
  conversion: [
    "単一CTA",
    "複数CTA",
    "社会的証明",
    "比較表",
    "フォーム中心",
    "価格表示",
    "カウントダウン",
    "ポップアップ",
    "無料トライアル訴求",
    "事例・ケーススタディ",
    "FAQ",
    "チャットbot",
    "ビデオ活用",
  ],
  visual_material: [
    "イラスト中心",
    "写真中心",
    "3D・CG",
    "アイコン多用",
    "アニメーション",
    "ビデオ背景",
    "データビジュアライゼーション",
    "製品写真",
    "テキストのみ",
    "パターン・テクスチャ",
  ],
};

// ============================================================
// 型定義
// ============================================================
interface TagResult {
  design_tone: string[];
  color_scheme: string[];
  layout_pattern: string[];
  typography: string[];
  navigation: string[];
  conversion: string[];
  visual_material: string[];
}

// ============================================================
// メイン処理
// ============================================================
async function main() {
  console.log(`[tag] 開始（最大${BATCH_LIMIT}件）`);

  // 未タグ付けのページを取得
  const { data: pages, error } = await supabase
    .from("pages")
    .select("page_id, screenshot_pc, page_type")
    .or("design_tone.is.null,design_tone.eq.{}")
    .not("screenshot_pc", "is", null)
    .limit(BATCH_LIMIT);

  if (error) {
    console.error("[tag] ページ取得エラー:", error.message);
    process.exit(1);
  }

  if (!pages || pages.length === 0) {
    console.log("[tag] タグ付け対象なし。終了します。");
    return;
  }

  console.log(`[tag] ${pages.length}件をバッチタグ付けします`);

  // バッチリクエストを構築
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const pageIds: string[] = [];

  for (const page of pages) {
    try {
      const imageBase64 = await fetchImageAsBase64(page.screenshot_pc);
      const prompt = buildTaggingPrompt(page.page_type);

      requests.push({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: imageBase64,
                },
              },
              { type: "text", text: prompt },
            ],
          },
        ],
      });
      pageIds.push(page.page_id);
    } catch (err) {
      console.error(`[tag] 画像取得失敗 page_id=${page.page_id}:`, err);
    }
  }

  if (requests.length === 0) {
    console.log("[tag] バッチリクエストなし。終了します。");
    return;
  }

  // Batch API にまとめて送信
  console.log(`[tag] Batch API 送信中（${requests.length}件）...`);
  const batch = await anthropic.messages.batches.create({
    requests: requests.map((req, i) => ({
      custom_id: pageIds[i],
      params: req,
    })),
  });

  console.log(`[tag] バッチID: ${batch.id} 完了待ち...`);

  // ポーリングで完了を待つ
  const startTime = Date.now();
  let batchResult = batch;
  while (batchResult.processing_status !== "ended") {
    if (Date.now() - startTime > MAX_WAIT_MS) {
      console.error("[tag] タイムアウト。次回実行時に再試行されます。");
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    batchResult = await anthropic.messages.batches.retrieve(batch.id);
    console.log(`[tag] ステータス: ${batchResult.processing_status}`);
  }

  // 結果を取得して Supabase に保存
  console.log("[tag] 結果取得・DB更新中...");
  for await (const result of await anthropic.messages.batches.results(
    batch.id,
  )) {
    const pageId = result.custom_id;
    if (result.result.type !== "succeeded") {
      console.error(`[tag] ❌ 失敗 page_id=${pageId}:`, result.result.type);
      continue;
    }

    try {
      const text = result.result.message.content
        .filter((c) => c.type === "text")
        .map((c) => (c as Anthropic.TextBlock).text)
        .join("");

      const tagged = parseTagResponse(text);

      const { error: updateError } = await supabase
        .from("pages")
        .update({
          design_tone: tagged.design_tone,
          color_scheme: tagged.color_scheme,
          layout_pattern: tagged.layout_pattern,
          typography_tags: tagged.typography,
          navigation_tags: tagged.navigation,
          conversion_tags: tagged.conversion,
          visual_material: tagged.visual_material,
        })
        .eq("page_id", pageId);

      if (updateError)
        throw new Error(`pages 更新エラー: ${updateError.message}`);

      console.log(`[tag] ✅ 完了`);
      console.log(`[tag]   トーン: ${tagged.design_tone.join(", ")}`);
      console.log(`[tag]   カラー: ${tagged.color_scheme.join(", ")}`);
      console.log(`[tag]   レイアウト: ${tagged.layout_pattern.join(", ")}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[tag] ❌ エラー page_id=${pageId} - ${message}`);
    }
  }

  console.log("\n[tag] 全処理完了");
}

// ============================================================
// プロンプト
// ============================================================
function buildTaggingPrompt(pageType: string): string {
  return `あなたはWebデザインの専門家です。スクリーンショットを見て、以下の分類軸ごとにタグを選択してください。

## ページ種別
${pageType}

## 分類ルール
- 各軸から当てはまるタグを1〜3個選ぶ
- 確信が持てないタグは選ばない
- 候補にないタグは選ばない

## ③ デザイントーン（候補）
${TAG_DEFINITIONS.design_tone.join("、")}

## ④ カラースキーム（候補）
${TAG_DEFINITIONS.color_scheme.join("、")}

## ⑤ レイアウトパターン（候補）
${TAG_DEFINITIONS.layout_pattern.join("、")}

## ⑨ タイポグラフィ（候補）
${TAG_DEFINITIONS.typography.join("、")}

## ⑪ ナビゲーション（候補）
${TAG_DEFINITIONS.navigation.join("、")}

## ⑫ コンバージョン設計（候補）
${TAG_DEFINITIONS.conversion.join("、")}

## ⑳ ビジュアル素材（候補）
${TAG_DEFINITIONS.visual_material.join("、")}

## 出力形式（必ずこのJSON形式のみで回答してください）
{
  "design_tone": ["タグ1", "タグ2"],
  "color_scheme": ["タグ1", "タグ2"],
  "layout_pattern": ["タグ1"],
  "typography": ["タグ1", "タグ2"],
  "navigation": ["タグ1"],
  "conversion": ["タグ1", "タグ2"],
  "visual_material": ["タグ1"]
}`;
}

// ============================================================
// レスポンスパース
// ============================================================
function parseTagResponse(text: string): TagResult {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`JSONが見つかりません: ${text.slice(0, 200)}`);

  const parsed = JSON.parse(match[0]);

  const toArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((s) => typeof s === "string") : [];

  return {
    design_tone: toArray(parsed.design_tone),
    color_scheme: toArray(parsed.color_scheme),
    layout_pattern: toArray(parsed.layout_pattern),
    typography: toArray(parsed.typography),
    navigation: toArray(parsed.navigation),
    conversion: toArray(parsed.conversion),
    visual_material: toArray(parsed.visual_material),
  };
}

// ============================================================
// 画像 → base64
// ============================================================
async function fetchImageAsBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`画像取得失敗: ${url} (${res.status})`);
  const buffer = await res.arrayBuffer();
  return Buffer.from(buffer).toString("base64");
}

// ============================================================
// 実行
// ============================================================
main().catch((err) => {
  console.error("[tag] 予期しないエラー:", err);
  process.exit(1);
});
