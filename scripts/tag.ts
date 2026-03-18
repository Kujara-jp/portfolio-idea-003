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
 *   + page_type（「その他・未分類」の場合のみ AI 判定）
 *
 * 実行方法:
 *   npx tsx scripts/tag.ts                          # 未タグページをタグ付け
 *   npx tsx scripts/tag.ts --limit=5                # 最大5件
 *   npx tsx scripts/tag.ts --reclassify --limit=10  # 「その他・未分類」を再分類
 */

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

// ============================================================
// 設定
// ============================================================
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY!;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const BATCH_LIMIT = limitArg ? parseInt(limitArg.split("=")[1]) : 5;
const RECLASSIFY_MODE = args.includes("--reclassify");

const POLL_INTERVAL_MS = 30_000; // 30秒おきにポーリング
const MAX_WAIT_MS = 25 * 60 * 1000; // 最大25分待機

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// ============================================================
// 有効な page_type 一覧
// ============================================================
const VALID_PAGE_TYPES = [
  "コーポレートサイト",
  "会社概要・About",
  "サービス紹介",
  "料金・プラン",
  "事例・実績",
  "ブログ・オウンドメディア",
  "ニュース・お知らせ",
  "採用サイト",
  "お問い合わせ",
  "LP（ランディングページ）",
  "ECサイト",
  "商品・物件・案件詳細",
  "ログイン・会員登録",
  "プライバシーポリシー・利用規約",
  "スタッフ・チーム紹介",
  "イベント・キャンペーン",
  "資料請求・ダウンロード",
  "予約・booking",
  "比較・特長",
  "検索結果・一覧",
  "404",
  "エラー・メンテナンス",
  "サンクス・完了",
  "ダッシュボード・マイページ",
  "Onboarding・チュートリアル",
  "ランキング・おすすめ",
  "FAQ・よくある質問",
  "その他・未分類",
];

// ============================================================
// タグ定義
// ============================================================
// DATABASE_DESIGN.md の正式タグ名を使用する（定義外の値は使用禁止）
const TAG_DEFINITIONS = {
  // ③ デザイントーン（DATABASE_DESIGN.md §4 ③ より抜粋）
  design_tone: [
    "ミニマル",
    "ボールド",
    "エレガント",
    "プレイフル",
    "コーポレート",
    "エディトリアル",
    "ナチュラル・オーガニック",
    "ラグジュアリー・ハイエンド",
    "レトロ・ヴィンテージ",
    "サイバー・テック",
    "ウォーム・アットホーム",
    "クール・スタイリッシュ",
    "和モダン",
    "北欧系",
    "フレンドリー・親しみやすい",
    "プロフェッショナル・信頼感",
    "エネルギッシュ・ダイナミック",
    "ダーク・ナイトモード系",
    "ポップ・カラフル",
    "アーティスティック・実験的",
    "サステナブル・エコ",
    "フューチャリスティック・SF系",
    "ゴシック・ダーク・オルタナティブ",
    "ハンドメイド・クラフト系",
    "ミッドセンチュリーモダン系",
    "ウェブブルータリスト系",
    "その他・未分類",
  ],
  // ④ カラースキーム（DATABASE_DESIGN.md §4 ④ より抜粋）
  color_scheme: [
    "ライト（白基調）",
    "クリーム・アイボリー系",
    "ダーク（黒・深色基調）",
    "モノクロ・グレースケール",
    "ネイビー・ロイヤルブルー系",
    "アースカラー",
    "ナチュラルグリーン系",
    "ミント・エメラルド系",
    "パステル（淡色・ソフトトーン）",
    "ローズ・ピンク系",
    "ラベンダー・パープル系",
    "イエロー・マスタード系",
    "レッド・バーガンディ系",
    "ウォームトーン（暖色系）",
    "クールトーン（寒色系）",
    "ビビッド・原色系",
    "ネオン・蛍光系",
    "グラデーション多用",
    "ゴールド・シルバー（メタリック）",
    "その他・未分類",
  ],
  // ⑤ レイアウトパターン（DATABASE_DESIGN.md §4 ⑤ より抜粋）
  layout_pattern: [
    "ヒーロー中央配置",
    "ヒーロー左寄せ（テキスト左・画像右）",
    "左右分割（Split / Half-Half）",
    "フルスクリーンビジュアル",
    "ジグザグ・交互配置型",
    "グリッド型（規則）",
    "マソンリー（不規則グリッド）型",
    "カード型",
    "マガジン・エディトリアル型",
    "ワンカラム縦積み",
    "センタリング縦積み型",
    "非対称・自由配置（アシンメトリー）",
    "タイムライン型",
    "比較・対比レイアウト",
    "タブ・アコーディオン中心型",
    "スクロールストーリーテリング型",
    "サイドバー付き2カラム型",
    "フルページスナップ型",
    "スワイプ・横スクロール型",
    "その他・未分類",
  ],
  // ⑨ タイポグラフィ詳細（DATABASE_DESIGN.md §4 ⑨ より抜粋）
  typography: [
    "サンセリフ中心",
    "セリフ中心",
    "手書き・スクリプト系",
    "ディスプレイ・デコラティブ系",
    "モノスペース・コード系",
    "和文フォント強調",
    "セリフ＋サンセリフ混在",
    "ビッグタイポ（超大見出し）",
    "標準サイズ感",
    "小さめ・繊細な組み",
    "ゆったり（広い行間）",
    "中央揃えメイン",
    "日英混植",
    "全大文字（All Caps）多用",
    "見出しと本文のサイズ比が大きい",
    "縦書き要素あり",
    "カラーテキスト・グラデーションテキスト",
    "その他・未分類",
  ],
  // ⑪ ナビゲーション構造（DATABASE_DESIGN.md §4 ⑪ より抜粋）
  navigation: [
    "固定ヘッダーナビ（PC横並び）",
    "ドロップダウン・メガメニュー",
    "ハンバーガーメニュー（PCも）",
    "フルスクリーンメニュー",
    "パネル・ドロワー型ナビ",
    "ドック型ナビ（中央浮遊型）",
    "サイドバー型ナビ",
    "ボトムナビ（SP下部固定）",
    "ワンページスクロール",
    "スクロール追従ナビ",
    "タブナビゲーション",
    "カテゴリ・フィルターナビ",
    "検索バー中心",
    "その他・未分類",
  ],
  // ⑫ コンバージョン設計パターン（DATABASE_DESIGN.md §4 ⑫ より抜粋）
  conversion: [
    "単一CTA集中型",
    "複数CTA並列型",
    "フローティングCTAボタン",
    "ポップアップ・離脱防止CV",
    "社会的証明重視（数値・実績）",
    "ロゴ・メディア掲載バナー",
    "お客様の声・事例主体",
    "比較表・料金表主体",
    "フォーム最小化",
    "ステップ型フォーム",
    "チャット・LINE誘導",
    "動画訴求型",
    "無料体験・トライアル訴求",
    "緊急性・限定性訴求",
    "保証・返金・リスクリバーサル訴求",
    "資料・ホワイトペーパーダウンロード型",
    "その他・未分類",
  ],
  // ⑳ ビジュアル素材の種類（DATABASE_DESIGN.md §4 ⑳ より抜粋）
  visual_material: [
    "リアル写真（オリジナル）",
    "リアル写真（ストック）",
    "オリジナルイラスト",
    "フラットイラスト・アイコン",
    "手描き・水彩・アナログ素材",
    "AIイラスト・AI生成画像",
    "SVGアニメーション素材",
    "写真＋イラスト混在（コラージュ）",
    "3D・CGレンダリング",
    "WebGL・インタラクティブCG",
    "モーション・動画",
    "パターン・テクスチャ素材",
    "インフォグラフィック",
    "データビジュアライゼーション素材",
    "UI画面・スクリーンショット",
    "テキスト中心",
    "その他・未分類",
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
  page_type: string | null;
}

// ============================================================
// メイン処理
// ============================================================
async function main() {
  const modeLabel = RECLASSIFY_MODE ? "reclassify" : "tag";
  console.log(`[tag] 開始（${modeLabel}モード、最大${BATCH_LIMIT}件）`);

  // ページ取得: reclassify モードは「その他・未分類」を対象、通常は未タグページ
  let query = supabase
    .from("pages")
    .select("page_id, screenshot_pc, page_type, page_url")
    .or("is_blocked.eq.false,is_blocked.is.null")
    .not("screenshot_pc", "is", null);

  if (RECLASSIFY_MODE) {
    query = query.eq("page_type", "その他・未分類");
  } else {
    query = query.or("design_tone.is.null,design_tone.eq.{}");
  }

  const { data: pages, error } = await query.limit(BATCH_LIMIT);

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
      const prompt = buildTaggingPrompt(page.page_type, page.page_url ?? "");

      requests.push({
        model: "claude-haiku-4-5",
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

      // タグ更新データを構築
      const updateData: Record<string, unknown> = {
        design_tone: tagged.design_tone,
        color_scheme: tagged.color_scheme,
        layout_pattern: tagged.layout_pattern,
        typography_tags: tagged.typography,
        navigation_tags: tagged.navigation,
        conversion_tags: tagged.conversion,
        visual_material: tagged.visual_material,
      };

      // page_type が AI 判定で返され、現在値と異なる場合のみ更新
      const currentPage = pages!.find((p) => p.page_id === pageId);
      if (tagged.page_type && currentPage && tagged.page_type !== currentPage.page_type) {
        updateData.page_type = tagged.page_type;
        console.log(`[tag] page_type 更新: ${currentPage.page_type} → ${tagged.page_type}`);
      }

      const { error: updateError } = await supabase
        .from("pages")
        .update(updateData)
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
function buildTaggingPrompt(pageType: string, pageUrl: string): string {
  // page_type が「その他・未分類」の場合、AI にページ種別判定を依頼
  const pageTypeSection = pageType === "その他・未分類"
    ? `## ページ情報
- URL: ${pageUrl}
- 現在の page_type: ${pageType}（未分類）

## ページ種別判定
現在「その他・未分類」になっています。スクリーンショットとURLから、最も適切なページ種別を以下の候補から1つ選んでください:
${VALID_PAGE_TYPES.filter((t) => t !== "その他・未分類").join("、")}

判定できない場合は null としてください。`
    : `## ページ情報
- URL: ${pageUrl}
- page_type: ${pageType}`;

  return `あなたはWebデザインの専門家です。スクリーンショットを見て、以下の分類軸ごとにタグを選択してください。

${pageTypeSection}

## 分類ルール（厳守事項）
- 各軸から当てはまるタグを1〜3個選ぶ
- 確信が持てないタグは選ばない
- **候補リストに存在するタグ名を一字一句正確にそのまま使うこと。候補にない文字列・表現・略称・類似語は絶対に使用禁止**
- 例: 「クリーン・モダン」「モダン」「シンプル」「プロフェッショナル」「ライト背景」「ダーク背景」等の候補外の値は絶対に出力してはならない
- 例: 「ミニマル」は候補にある。「モダン」は候補にない。必ず「ミニマル」を選ぶこと
- 例: 「プロフェッショナル・信頼感」は候補にある。「プロフェッショナル」は候補にない。必ず「プロフェッショナル・信頼感」を選ぶこと
- 例: 「ライト（白基調）」「ダーク（黒・深色基調）」は候補にある。「ライト背景」「ダーク背景」は候補にない。
- 判断に迷う場合は「その他・未分類」を選ぶ（絶対に候補外の値を作らない）
- クッキー同意バナー、ポップアップ、クーポン表示などのオーバーレイ要素は無視して、背後のメインコンテンツのデザインを評価すること
- オーバーレイが大きくメインコンテンツが見えない場合はその旨を判断の根拠にしないこと

## タイポグラフィ判定の重要注意事項
- 「日本語フォント重視」は、サイトの主要コンテンツが日本語で書かれており、かつ日本語フォントの選定・ウェイト・字間に明確なこだわりが見られる場合のみ選択すること
- 主要コンテンツが英語、中国語、韓国語など日本語以外の言語で書かれているサイトには「日本語フォント重視」を絶対に選択しないこと
- 同様に「欧文フォント重視」は、欧文（ラテン文字）のフォント選定に明確なこだわりが見られる場合に選択すること

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
  "visual_material": ["タグ1"],
  "page_type": "ページ種別（未分類の場合のみ判定、それ以外はnull）"
}`;
}

// ============================================================
// レスポンスパース
// ============================================================
function parseTagResponse(text: string): TagResult {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`JSONが見つかりません: ${text.slice(0, 200)}`);

  const parsed = JSON.parse(match[0]);

  // 定義済みタグリストに含まれる値のみを返す（定義外タグを除外）
  const toValidArray = (v: unknown, validTags: string[]): string[] => {
    if (!Array.isArray(v)) return [];
    const filtered = v.filter((s) => typeof s === "string" && validTags.includes(s));
    const invalid = v.filter((s) => typeof s === "string" && !validTags.includes(s));
    if (invalid.length > 0) {
      console.warn(`[tag] 定義外タグを除外しました: ${invalid.join(", ")}`);
    }
    return filtered;
  };

  // page_type のバリデーション: 有効値リストに含まれる場合のみ採用
  let pageType: string | null = null;
  if (typeof parsed.page_type === "string" && VALID_PAGE_TYPES.includes(parsed.page_type)) {
    pageType = parsed.page_type;
  }

  return {
    design_tone: toValidArray(parsed.design_tone, TAG_DEFINITIONS.design_tone),
    color_scheme: toValidArray(parsed.color_scheme, TAG_DEFINITIONS.color_scheme),
    layout_pattern: toValidArray(parsed.layout_pattern, TAG_DEFINITIONS.layout_pattern),
    typography: toValidArray(parsed.typography, TAG_DEFINITIONS.typography),
    navigation: toValidArray(parsed.navigation, TAG_DEFINITIONS.navigation),
    conversion: toValidArray(parsed.conversion, TAG_DEFINITIONS.conversion),
    visual_material: toValidArray(parsed.visual_material, TAG_DEFINITIONS.visual_material),
    page_type: pageType,
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
