/**
 * design-vault: タグ付けスクリプト
 * スクリーンショットを Claude Vision API に送り、以下を自動タグ付けする
 *   ③ デザイントーン
 *   ④ カラースキーム
 *   ⑤ レイアウトパターン
 *   ⑨ タイポグラフィ詳細
 *   ⑩ インタラクション（推定）
 *   ⑪ ナビゲーション構造
 *   ⑫ コンバージョン設計
 *   ⑳ ビジュアル素材
 *
 * 実行方法:
 *   npx tsx scripts/tag.ts
 *   npx tsx scripts/tag.ts --limit=5
 */

import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

// ============================================================
// 設定
// ============================================================
const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!

const args = process.argv.slice(2)
const limitArg = args.find(a => a.startsWith('--limit='))
const BATCH_LIMIT = limitArg ? parseInt(limitArg.split('=')[1]) : 5

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY })

// ============================================================
// タグ定義
// ============================================================
const TAG_DEFINITIONS = {
  design_tone: [
    'ミニマル', 'ボールド', 'エレガント', 'プレイフル', 'コーポレート',
    'テック・近未来', 'オーガニック・ナチュラル', 'レトロ・ヴィンテージ',
    'ラグジュアリー', 'フレンドリー', 'プロフェッショナル', 'クリエイティブ',
    'ダーク・エッジー', 'クリーン・モダン', 'ウォーム・カジュアル',
  ],
  color_scheme: [
    'ライト背景', 'ダーク背景', 'ホワイト中心', 'ブラック中心',
    'アースカラー', 'パステル', 'ビビッド・鮮やか', 'モノクロ',
    'グラデーション', 'ブルー系', 'グリーン系', 'レッド系',
    'パープル系', 'オレンジ系', 'ゴールド・シルバー',
  ],
  layout_pattern: [
    'ヒーロー中央', 'ヒーロー左寄せ', 'ジグザグ', 'グリッド',
    'フルスクリーン', 'カード型', 'タイムライン', 'マガジン型',
    'ワンカラム', 'サイドバー付き', 'マルチカラム', 'アシンメトリー',
    'スクロールストーリー', 'タブ切り替え', 'モーダル多用',
  ],
  typography: [
    'サンセリフ中心', 'セリフ中心', 'ビッグタイポ', 'スモールテキスト多用',
    '日本語フォント重視', '欧文フォント重視', 'モノスペース使用',
    'ハンドライティング', '太字強調', 'カラーテキスト強調',
    '細字エレガント', '大見出し小本文', 'テキスト少なめ',
  ],
  navigation: [
    '固定ヘッダー', 'ハンバーガーメニュー', 'フルスクリーンメニュー',
    'サイドナビ', 'ボトムナビ', 'アンカーリンク', 'ステップ型',
    'メガメニュー', 'スクロール連動', 'フローティングボタン',
  ],
  conversion: [
    '単一CTA', '複数CTA', '社会的証明', '比較表', 'フォーム中心',
    '価格表示', 'カウントダウン', 'ポップアップ', '無料トライアル訴求',
    '事例・ケーススタディ', 'FAQ', 'チャットbot', 'ビデオ活用',
  ],
  visual_material: [
    'オリジナル写真', 'ストック写真', 'イラスト', 'アイコン中心',
    '3D・CG', 'アニメーション・GIF', '動画背景', 'AI生成画像',
    '図解・インフォグラフィック', 'スクリーンショット活用', '人物写真',
    '製品写真', 'テキストのみ', 'パターン・テクスチャ',
  ],
}

// ============================================================
// 型定義
// ============================================================
interface TagResult {
  design_tone: string[]
  color_scheme: string[]
  layout_pattern: string[]
  typography: string[]
  navigation: string[]
  conversion: string[]
  visual_material: string[]
}

// ============================================================
// メイン処理
// ============================================================
async function main() {
  console.log(`[tag] 開始 (最大${BATCH_LIMIT}件)`)

  // 未タグ付けのページを取得（空配列 {} も未処理扱い）
  const { data: pages, error } = await supabase
    .from('pages')
    .select('page_id, screenshot_pc, page_type')
    .or('design_tone.is.null,design_tone.eq.{}')
    .not('screenshot_pc', 'is', null)
    .limit(BATCH_LIMIT)

  if (error) {
    console.error('[tag] ページ取得エラー:', error.message)
    process.exit(1)
  }

  if (!pages || pages.length === 0) {
    console.log('[tag] タグ付け対象なし。終了します。')
    return
  }

  console.log(`[tag] ${pages.length}件をタグ付けします`)

  for (const page of pages) {
    console.log(`\n[tag] タグ付け中: page_id=${page.page_id}`)

    try {
      const result = await tagWithVision(page.screenshot_pc, page.page_type)

      const { error: updateError } = await supabase
        .from('pages')
        .update({
          design_tone: result.design_tone,
          color_scheme: result.color_scheme,
          layout_pattern: result.layout_pattern,
          typography_tags: result.typography,
          navigation_tags: result.navigation,
          conversion_tags: result.conversion,
          visual_material: result.visual_material,
        })
        .eq('page_id', page.page_id)

      if (updateError) throw new Error(`pages 更新エラー: ${updateError.message}`)

      console.log(`[tag] ✅ 完了`)
      console.log(`[tag]   トーン: ${result.design_tone.join(', ')}`)
      console.log(`[tag]   カラー: ${result.color_scheme.join(', ')}`)
      console.log(`[tag]   レイアウト: ${result.layout_pattern.join(', ')}`)

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[tag] ❌ エラー: page_id=${page.page_id} - ${message}`)
    }
  }

  console.log('\n[tag] 全処理完了')
}

// ============================================================
// Claude Vision API タグ付け
// ============================================================
async function tagWithVision(screenshotUrl: string, pageType: string): Promise<TagResult> {
  const imageBase64 = await fetchImageAsBase64(screenshotUrl)

  const prompt = buildTaggingPrompt(pageType)

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: imageBase64 }
        },
        { type: 'text', text: prompt }
      ]
    }]
  })

  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => (b as Anthropic.TextBlock).text)
    .join('')

  return parseTagResponse(text)
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
${TAG_DEFINITIONS.design_tone.join('、')}

## ④ カラースキーム（候補）
${TAG_DEFINITIONS.color_scheme.join('、')}

## ⑤ レイアウトパターン（候補）
${TAG_DEFINITIONS.layout_pattern.join('、')}

## ⑨ タイポグラフィ（候補）
${TAG_DEFINITIONS.typography.join('、')}

## ⑪ ナビゲーション構造（候補）
${TAG_DEFINITIONS.navigation.join('、')}

## ⑫ コンバージョン設計（候補）
${TAG_DEFINITIONS.conversion.join('、')}

## ⑳ ビジュアル素材（候補）
${TAG_DEFINITIONS.visual_material.join('、')}

## 出力形式（必ずこのJSON形式のみで回答してください）

{
  "design_tone": ["タグ1", "タグ2"],
  "color_scheme": ["タグ1", "タグ2"],
  "layout_pattern": ["タグ1"],
  "typography": ["タグ1", "タグ2"],
  "navigation": ["タグ1"],
  "conversion": ["タグ1", "タグ2"],
  "visual_material": ["タグ1", "タグ2"]
}`
}

// ============================================================
// レスポンスパース
// ============================================================
function parseTagResponse(text: string): TagResult {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error(`JSONが見つかりません: ${text.slice(0, 200)}`)

  const parsed = JSON.parse(match[0])

  const toArray = (val: unknown): string[] =>
    Array.isArray(val) ? val.filter((v): v is string => typeof v === 'string') : []

  return {
    design_tone: toArray(parsed.design_tone),
    color_scheme: toArray(parsed.color_scheme),
    layout_pattern: toArray(parsed.layout_pattern),
    typography: toArray(parsed.typography),
    navigation: toArray(parsed.navigation),
    conversion: toArray(parsed.conversion),
    visual_material: toArray(parsed.visual_material),
  }
}

// ============================================================
// 画像 → base64
// ============================================================
async function fetchImageAsBase64(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`画像取得失敗: ${url} (${res.status})`)
  const buffer = await res.arrayBuffer()
  return Buffer.from(buffer).toString('base64')
}

// ============================================================
// 実行
// ============================================================
main().catch(err => {
  console.error('[tag] 予期しないエラー:', err)
  process.exit(1)
})
