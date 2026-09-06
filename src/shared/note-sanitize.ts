/**
 * Gemini へ送る前にノート本文を削る。
 *
 * ノートは Markdown なので、そのまま送るとコードブロックや画像の URL まで
 * トークンを食う。無料枠だとこれが効いてレート制限（429）に当たりやすい。
 *
 * **サーバーが実際に切り詰め、クライアントが同じ基準で注記を出す**ため shared に置く。
 * ここがズレると「注記が出ていないのに切られている」状態になる。
 */

/** 1 回のリクエストで送る本文の上限 */
export const MAX_PROMPT_CHARS = 2500;

/** 切り詰めたことが分かるよう末尾に付ける */
export const TRUNCATION_SUFFIX = '...（以降省略）';

/**
 * 出題の材料にならないものを落とす。
 *
 * 落とすのは「読んでも問題が作れないのにトークンだけ食うもの」に限る。
 * インラインコード（`TCP` のような表記）は用語そのものであることが多いので**残す**。
 */
export function sanitizeForPrompt(content: string): string {
  return (
    content
      // data: の Base64 埋め込み。画像 1 枚で数千トークンになりうる。
      // 画像記法より先に落とす（![](data:...) の内側を短くしてから記法を消す）
      .replace(/data:[a-zA-Z0-9/+.-]+;base64,[A-Za-z0-9+/=]+/g, '')
      // フェンス付きコードブロック。長いわりに用語が薄い。
      .replace(/```[\s\S]*?```/g, '')
      // 画像リンク。alt だけ残しても出題には使えない。
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      // HTML の img タグ（Markdown に直接書かれることがある）
      .replace(/<img\b[^>]*>/gi, '')
      // マーカー（==テキスト==）の記号だけ外す。
      // 中身は本文の一部なので残す。記号は出題に使えないノイズ。
      .replace(/==(?!\s)([^=]+?)(?<!\s)==/g, '$1')
      // 上の除去で空行だらけになるので畳む
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

export interface TruncationResult {
  text: string;
  /** 切り詰めたか。UI の注記の出し分けに使う。 */
  truncated: boolean;
}

/** 先頭から max 文字で切り、切ったことが分かる印を付ける */
export function truncateForPrompt(content: string, max = MAX_PROMPT_CHARS): TruncationResult {
  if (content.length <= max) return { text: content, truncated: false };
  return { text: content.slice(0, max) + TRUNCATION_SUFFIX, truncated: true };
}

/**
 * 送信用の本文を作る。サニタイズ → 切り詰めの順。
 *
 * **サニタイズで空になったら元の本文を使う。** ノートが丸ごとコードブロックだと
 * 除去後に何も残らず、いままで生成できていたものが失敗する。
 * トークン節約のための変更が、生成できなくなる退行になってはいけない。
 */
export function buildPromptSource(content: string, max = MAX_PROMPT_CHARS): TruncationResult {
  const sanitized = sanitizeForPrompt(content);
  const source = sanitized === '' ? content.trim() : sanitized;
  return truncateForPrompt(source, max);
}

/** UI の注記を出すか。送信時と同じ基準で判定する。 */
export function willTruncate(content: string, max = MAX_PROMPT_CHARS): boolean {
  return buildPromptSource(content, max).truncated;
}
