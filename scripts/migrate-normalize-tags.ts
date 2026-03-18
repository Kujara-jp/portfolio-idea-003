/**
 * design-vault: タグ値正規化マイグレーションスクリプト
 * DATABASE_DESIGN.md の正式名称に統一する（旧タグ → 新タグ）
 *
 * 実行方法:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/migrate-normalize-tags.ts
 *   npx tsx scripts/migrate-normalize-tags.ts --dry-run  # 変更件数のみ確認
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY!;
const DRY_RUN = process.argv.includes("--dry-run");

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    "[migrate] SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY の環境変数が必要です"
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================
// 正規化マッピング定義
// key: フィールド名, value: { old: 旧タグ名, new: 新タグ名, needsReview?: true }
// ============================================================
const NORMALIZATION_RULES: {
  field: string;
  old: string;
  new: string;
  needsReview?: boolean;
}[] = [
  // ③ design_tone
  { field: "design_tone", old: "オーガニック・ナチュラル", new: "ナチュラル・オーガニック" },
  { field: "design_tone", old: "テック・近未来", new: "サイバー・テック" },
  { field: "design_tone", old: "ラグジュアリー", new: "ラグジュアリー・ハイエンド" },
  { field: "design_tone", old: "フレンドリー", new: "フレンドリー・親しみやすい" },
  { field: "design_tone", old: "プロフェッショナル", new: "プロフェッショナル・信頼感" },
  { field: "design_tone", old: "クリエイティブ", new: "アーティスティック・実験的" },
  { field: "design_tone", old: "ダーク・エッジー", new: "ゴシック・ダーク・オルタナティブ" },
  { field: "design_tone", old: "クリーン・モダン", new: "ミニマル" },
  { field: "design_tone", old: "ウォーム・カジュアル", new: "ウォーム・アットホーム" },

  // ④ color_scheme
  { field: "color_scheme", old: "ライト背景", new: "ライト（白基調）" },
  { field: "color_scheme", old: "ダーク背景", new: "ダーク（黒・深色基調）" },
  { field: "color_scheme", old: "ホワイト中心", new: "ライト（白基調）" },
  { field: "color_scheme", old: "ブラック中心", new: "ダーク（黒・深色基調）" },
  { field: "color_scheme", old: "ビビッド・鮮やか", new: "ビビッド・原色系" },
  { field: "color_scheme", old: "モノクロ", new: "モノクロ・グレースケール" },
  { field: "color_scheme", old: "グラデーション", new: "グラデーション多用" },
  { field: "color_scheme", old: "ブルー系", new: "ネイビー・ロイヤルブルー系" },
  { field: "color_scheme", old: "グリーン系", new: "ナチュラルグリーン系" },
  { field: "color_scheme", old: "レッド系", new: "レッド・バーガンディ系" },
  { field: "color_scheme", old: "パープル系", new: "ラベンダー・パープル系" },
  { field: "color_scheme", old: "オレンジ系", new: "ウォームトーン（暖色系）" },
  { field: "color_scheme", old: "ゴールド・シルバー", new: "ゴールド・シルバー（メタリック）" },

  // ⑤ layout_pattern
  { field: "layout_pattern", old: "ヒーロー中央", new: "ヒーロー中央配置" },
  { field: "layout_pattern", old: "ヒーロー左寄せ", new: "ヒーロー左寄せ（テキスト左・画像右）" },
  { field: "layout_pattern", old: "ジグザグ", new: "ジグザグ・交互配置型" },
  { field: "layout_pattern", old: "グリッド", new: "グリッド型（規則）" },
  { field: "layout_pattern", old: "フルスクリーン", new: "フルスクリーンビジュアル" },
  { field: "layout_pattern", old: "タイムライン", new: "タイムライン型" },
  { field: "layout_pattern", old: "マガジン型", new: "マガジン・エディトリアル型" },
  { field: "layout_pattern", old: "ワンカラム", new: "ワンカラム縦積み" },
  { field: "layout_pattern", old: "サイドバー付き", new: "サイドバー付き2カラム型" },
  { field: "layout_pattern", old: "マルチカラム", new: "グリッド型（規則）" },
  { field: "layout_pattern", old: "アシンメトリー", new: "非対称・自由配置（アシンメトリー）" },
  { field: "layout_pattern", old: "スクロールストーリー", new: "スクロールストーリーテリング型" },
  { field: "layout_pattern", old: "タブ切り替え", new: "タブ・アコーディオン中心型" },
  { field: "layout_pattern", old: "モーダル多用", new: "その他・未分類", needsReview: true },

  // ⑨ typography（DBフィールド名: typography）
  { field: "typography", old: "スモールテキスト多用", new: "小さめ・繊細な組み" },
  { field: "typography", old: "日本語フォント重視", new: "和文フォント強調" },
  { field: "typography", old: "欧文フォント重視", new: "その他・未分類", needsReview: true },
  { field: "typography", old: "モノスペース使用", new: "モノスペース・コード系" },
  { field: "typography", old: "ハンドライティング", new: "手書き・スクリプト系" },
  { field: "typography", old: "太字強調", new: "見出しと本文のサイズ比が大きい" },
  { field: "typography", old: "カラーテキスト装飾", new: "カラーテキスト・グラデーションテキスト" },
  { field: "typography", old: "細字エレガント", new: "小さめ・繊細な組み" },
  { field: "typography", old: "大見出し小本文", new: "見出しと本文のサイズ比が大きい" },
  { field: "typography", old: "テキスト少なめ", new: "その他・未分類", needsReview: true },

  // ⑪ navigation（DBフィールド名: navigation）
  { field: "navigation", old: "固定ヘッダー", new: "固定ヘッダーナビ（PC横並び）" },
  { field: "navigation", old: "ハンバーガーメニュー", new: "ハンバーガーメニュー（PCも）" },
  { field: "navigation", old: "サイドナビ", new: "サイドバー型ナビ" },
  { field: "navigation", old: "ボトムナビ", new: "ボトムナビ（SP下部固定）" },
  { field: "navigation", old: "アンカーリンク", new: "ワンページスクロール" },
  { field: "navigation", old: "ステップ型", new: "ステップ型ナビ（ウィザード）" },
  { field: "navigation", old: "メガメニュー", new: "ドロップダウン・メガメニュー" },
  { field: "navigation", old: "スクロール連動", new: "スクロール追従ナビ" },
  { field: "navigation", old: "フローティングボタン", new: "その他・未分類", needsReview: true },

  // ⑫ conversion（DBフィールド名: cv_pattern）
  { field: "cv_pattern", old: "単一CTA", new: "単一CTA集中型" },
  { field: "cv_pattern", old: "複数CTA", new: "複数CTA並列型" },
  { field: "cv_pattern", old: "社会的証明", new: "社会的証明重視（数値・実績）" },
  { field: "cv_pattern", old: "比較表", new: "比較表・料金表主体" },
  { field: "cv_pattern", old: "フォーム中心", new: "フォーム最小化" },
  { field: "cv_pattern", old: "価格表示", new: "比較表・料金表主体" },
  { field: "cv_pattern", old: "カウントダウン", new: "緊急性・限定性訴求" },
  { field: "cv_pattern", old: "ポップアップ", new: "ポップアップ・離脱防止CV" },
  { field: "cv_pattern", old: "無料トライアル訴求", new: "無料体験・トライアル訴求" },
  { field: "cv_pattern", old: "事例・ケーススタディ", new: "お客様の声・事例主体" },
  { field: "cv_pattern", old: "FAQ", new: "その他・未分類", needsReview: true },
  { field: "cv_pattern", old: "チャットbot", new: "チャット・LINE誘導" },
  { field: "cv_pattern", old: "ビデオ活用", new: "動画訴求型" },

  // ⑳ visual_material
  { field: "visual_material", old: "イラスト中心", new: "オリジナルイラスト" },
  { field: "visual_material", old: "写真中心", new: "リアル写真（オリジナル）" },
  { field: "visual_material", old: "3D・CG", new: "3D・CGレンダリング" },
  { field: "visual_material", old: "アイコン多用", new: "フラットイラスト・アイコン" },
  { field: "visual_material", old: "アニメーション", new: "モーション・動画" },
  { field: "visual_material", old: "ビデオ背景", new: "モーション・動画" },
  { field: "visual_material", old: "データビジュアライゼーション", new: "データビジュアライゼーション素材" },
  { field: "visual_material", old: "製品写真", new: "リアル写真（オリジナル）" },
  { field: "visual_material", old: "テキストのみ", new: "テキスト中心" },
  { field: "visual_material", old: "パターン・テクスチャ", new: "パターン・テクスチャ素材" },
];

// ============================================================
// メイン処理
// ============================================================
async function main(): Promise<void> {
  console.log(
    `[migrate] タグ値正規化マイグレーション開始（${DRY_RUN ? "DRY RUN" : "実行モード"}）`
  );
  console.log(`[migrate] ルール数: ${NORMALIZATION_RULES.length}`);

  // 全ページを100件ずつ処理
  let offset = 0;
  const CHUNK_SIZE = 100;
  let totalUpdated = 0;

  while (true) {
    const { data: pages, error } = await supabase
      .from("pages")
      .select("page_id, design_tone, color_scheme, layout_pattern, typography, navigation, cv_pattern, visual_material, needs_review")
      .range(offset, offset + CHUNK_SIZE - 1);

    if (error) {
      console.error("[migrate] ページ取得エラー:", error.message);
      process.exit(1);
    }

    if (!pages || pages.length === 0) break;

    console.log(`[migrate] ${offset + 1}〜${offset + pages.length}件目を処理中...`);

    let chunkUpdated = 0;
    for (const page of pages) {
      const updates: Record<string, unknown> = {};
      let needsReview = page.needs_review ?? false;

      for (const rule of NORMALIZATION_RULES) {
        const fieldValue = page[rule.field as keyof typeof page] as string[] | null;
        if (!fieldValue || !Array.isArray(fieldValue)) continue;
        if (!fieldValue.includes(rule.old)) continue;

        // 旧タグを新タグに置換し重複を除去
        const replaced = fieldValue.map((v) => (v === rule.old ? rule.new : v));
        const deduped = [...new Set(replaced)];
        updates[rule.field] = deduped;

        if (rule.needsReview) needsReview = true;

        console.log(
          `[migrate]   page_id=${page.page_id} ${rule.field}: "${rule.old}" → "${rule.new}"`
        );
      }

      if (Object.keys(updates).length === 0) continue;

      if (needsReview !== (page.needs_review ?? false)) {
        updates.needs_review = needsReview;
      }

      chunkUpdated++;
      totalUpdated++;

      if (DRY_RUN) continue;

      const { error: updateError } = await supabase
        .from("pages")
        .update(updates)
        .eq("page_id", page.page_id);

      if (updateError) {
        console.error(
          `[migrate] ❌ 更新エラー page_id=${page.page_id}: ${updateError.message}`
        );
      }
    }

    if (chunkUpdated > 0) {
      console.log(
        `[migrate] チャンク内更新対象: ${chunkUpdated}件${DRY_RUN ? "（DRY RUN）" : ""}`
      );
    }

    if (pages.length < CHUNK_SIZE) break;
    offset += CHUNK_SIZE;
  }

  console.log(
    `\n[migrate] 完了。更新対象ページ: ${totalUpdated}件${DRY_RUN ? "（DRY RUN: 実際には変更されていません）" : ""}`
  );
}

main().catch((err) => {
  console.error("[migrate] 予期しないエラー:", err);
  process.exit(1);
});
