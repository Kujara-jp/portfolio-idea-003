/**
 * URL正規化ユーティリティ
 * 全スクリプト共通で使用するURL正規化・比較関数
 */

/** 除去対象のトラッキングパラメータ */
const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
  "ref",
]);

/**
 * URLを正規化（カノニカル）形式に変換する
 *
 * 1. new URL() でパース
 * 2. プロトコルを https: に統一
 * 3. www. プレフィックスを除去
 * 4. デフォルトポート除去
 * 5. trailing slash 除去（ルート / は保持）
 * 6. 連続スラッシュ正規化
 * 7. トラッキングパラメータ除去
 * 8. 残りクエリパラメータをソート
 * 9. フラグメント除去
 */
export function canonicalizeUrl(raw: string): string {
  try {
    const url = new URL(raw);

    // プロトコルを https に統一
    url.protocol = "https:";

    // www. 除去
    url.hostname = url.hostname.replace(/^www\./, "");

    // ホスト名を小文字に（URL APIは通常やるが念のため）
    url.hostname = url.hostname.toLowerCase();

    // デフォルトポート除去（URL APIは通常やるが明示的に）
    url.port = "";

    // パスの連続スラッシュを正規化
    url.pathname = url.pathname.replace(/\/\/+/g, "/");

    // trailing slash 除去（ルート "/" は保持）
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }

    // トラッキングパラメータ除去
    const keysToDelete: string[] = [];
    url.searchParams.forEach((_val, key) => {
      if (TRACKING_PARAMS.has(key.toLowerCase())) {
        keysToDelete.push(key);
      }
    });
    for (const key of keysToDelete) {
      url.searchParams.delete(key);
    }

    // クエリパラメータをアルファベット順にソート
    url.searchParams.sort();

    // フラグメント除去
    url.hash = "";

    return url.toString();
  } catch {
    // パース失敗時はそのまま返す
    return raw;
  }
}

/**
 * 重複比較用の正規化キー
 * canonicalizeUrl() からプロトコルを除去した文字列を返す
 */
export function normalizeForDedup(raw: string): string {
  return canonicalizeUrl(raw).replace(/^https?:\/\//, "");
}

/**
 * URLからドメイン名のみを抽出（www. 除去済み）
 */
export function extractDomain(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return raw;
  }
}
