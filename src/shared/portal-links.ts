/**
 * ポータル（リンク集約）の判断を集めた層。**純粋関数だけ。**
 *
 * URL の検証・アイコンの決め方・検索・取り込みの解釈をここに寄せ、
 * ルートと画面は呼ぶだけにする（vitest は `environment: 'node'` で描画側を試せないため）。
 *
 * **URL の検証がこのファイルにしか無いのは意図的。**
 * `javascript:` や `data:` を `href` に入れてしまうと、保存したリンクを押した人の画面で
 * 任意のスクリプトが走る。入口（画面・POST・取り込み）が増えても、通る道は normalizeUrl 一本にする。
 */

import { normalizeForSearch } from './glossary-search';
import {
  MAX_PORTAL_CATEGORY_LENGTH,
  MAX_PORTAL_ICON_VALUE_LENGTH,
  MAX_PORTAL_TITLE_LENGTH,
  MAX_PORTAL_URL_LENGTH,
  type PortalIconKind,
  type PortalLinkDTO,
} from './types';

/** 書き出す JSON の目印。取り込みのときに「このアプリのファイルか」を見る */
export const PORTAL_EXPORT_APP = 'study-recall-portal';
export const PORTAL_EXPORT_VERSION = 1;

/** 取り込みで一度に受け取る上限。壊れた巨大ファイルで Worker を詰まらせない */
export const MAX_PORTAL_IMPORT_ROWS = 500;

export interface PortalLinkInput {
  title: string;
  url: string;
  category: string;
  iconKind: PortalIconKind;
  iconValue: string;
}

const ICON_KINDS: readonly PortalIconKind[] = ['favicon', 'emoji', 'image'];

export function coerceIconKind(value: unknown): PortalIconKind {
  return ICON_KINDS.includes(value as PortalIconKind) ? (value as PortalIconKind) : 'favicon';
}

/**
 * 保存・表示してよい URL に整える。だめなら null。
 *
 * - スキームが無ければ `https://` を足す（「github.com」と打てるようにする）
 * - **`http` / `https` 以外は通さない**（`javascript:` `data:` `file:` など）
 * - 長すぎるものも通さない
 */
export function normalizeUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_PORTAL_URL_LENGTH) return null;

  // スキーム付きに見えないものだけ https:// を補う。
  // `javascript:alert(1)` はスキーム付きに見えるので補われず、下の判定で落ちる。
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname) return null;

  const normalized = url.toString();
  return normalized.length > MAX_PORTAL_URL_LENGTH ? null : normalized;
}

/** 表示とファビコン取得に使うホスト名。取れなければ空文字 */
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * ファビコンの取得先（Google のサービス）。
 *
 * **登録したサイトのドメインが Google に伝わる。** それが嫌な人のために、
 * 画面では絵文字と画像 URL も選べるようにしてある。
 * オフラインでは読めないので、読み込みに失敗したら頭文字を出す（画面側の役目）。
 */
export function faviconUrl(url: string, size = 128): string {
  const domain = domainOf(url);
  if (!domain) return '';
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${size}`;
}

/** アイコンに出す頭文字。題名が空ならドメインの頭を使う */
export function initialOf(link: Pick<PortalLinkDTO, 'title' | 'url'>): string {
  const source = link.title.trim() || domainOf(link.url);
  return source ? [...source][0]! : '?';
}

/**
 * 画面に出すアイコンの実体を 1 つに決める。
 * 画像として出せないときは `null` を返し、呼び出し側は頭文字にする。
 */
export function iconImageOf(
  link: Pick<PortalLinkDTO, 'url' | 'iconKind' | 'iconValue'>,
): string | null {
  if (link.iconKind === 'emoji') return null;
  if (link.iconKind === 'image') return normalizeUrl(link.iconValue);
  return faviconUrl(link.url) || null;
}

function clamp(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * 入力（画面・API・取り込み）を保存できる形にそろえる。URL がだめなら null。
 * 絵文字が空のまま 'emoji' で来たら favicon に落とす（穴あきのアイコンを作らない）。
 */
export function normalizeLinkInput(raw: {
  title?: unknown;
  url?: unknown;
  category?: unknown;
  iconKind?: unknown;
  iconValue?: unknown;
}): PortalLinkInput | null {
  const url = normalizeUrl(raw.url);
  if (!url) return null;

  const title = clamp(raw.title, MAX_PORTAL_TITLE_LENGTH) || domainOf(url);
  const category = clamp(raw.category, MAX_PORTAL_CATEGORY_LENGTH);

  let iconKind = coerceIconKind(raw.iconKind);
  let iconValue = '';

  if (iconKind === 'emoji') {
    // 絵文字は結合文字・肌色などで複数コードポイントになる。文字数ではなく「1 書記素」で切る
    const emoji = clamp(raw.iconValue, MAX_PORTAL_ICON_VALUE_LENGTH);
    iconValue = emoji ? [...emoji].slice(0, 8).join('') : '';
    if (!iconValue) iconKind = 'favicon';
  } else if (iconKind === 'image') {
    const image = normalizeUrl(raw.iconValue);
    if (image && image.length <= MAX_PORTAL_ICON_VALUE_LENGTH) iconValue = image;
    else iconKind = 'favicon';
  }

  return { title, url, category, iconKind, iconValue };
}

/** 重複判定のキー。URL の末尾のスラッシュとスキームの違いで二重登録させない */
export function urlKey(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.hostname.replace(/^www\./, '')}${path}${parsed.search}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

/**
 * 検索とカテゴリの絞り込み。
 * 題名・URL・カテゴリを対象に、用語辞書と同じ正規化（NFKC・小文字・カタカナ→ひらがな）で畳む。
 */
export function filterLinks(
  links: readonly PortalLinkDTO[],
  { query = '', category = '' }: { query?: string; category?: string } = {},
): PortalLinkDTO[] {
  const needle = normalizeForSearch(query.trim());
  return links.filter((link) => {
    if (category && link.category !== category) return false;
    if (!needle) return true;
    const haystack = normalizeForSearch(`${link.title} ${link.url} ${link.category}`);
    return haystack.includes(needle);
  });
}

/**
 * カテゴリタブの素。**リンクが 1 件でもあるカテゴリだけ**を、件数付きで返す。
 * 並びは登録順（＝ sortOrder 順に入ってくる）を保つので、タブの位置が勝手に動かない。
 */
export function categoriesOf(links: readonly PortalLinkDTO[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const link of links) {
    if (!link.category) continue;
    counts.set(link.category, (counts.get(link.category) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count }));
}

/** 書き出す JSON（そのまま取り込める形） */
export function buildExport(links: readonly PortalLinkDTO[]): string {
  return JSON.stringify(
    {
      app: PORTAL_EXPORT_APP,
      version: PORTAL_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      links: links.map((link) => ({
        title: link.title,
        url: link.url,
        category: link.category,
        iconKind: link.iconKind,
        iconValue: link.iconValue,
      })),
    },
    null,
    2,
  );
}

export interface ParsedImport {
  links: PortalLinkInput[];
  /** 形が壊れていて捨てた件数 */
  skipped: number;
  /** ファイルとして読めなかった場合の理由 */
  error?: string;
}

/**
 * 取り込むファイルを解釈する。**1 件でも読めれば受け入れる。**
 * 壊れた行で全部を捨てると、手で直せない人にはどうにもできなくなる。
 */
export function parseImport(text: string): ParsedImport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { links: [], skipped: 0, error: 'JSON として読めませんでした' };
  }

  // { links: [...] } でも、配列そのままでも受け取る（他のツールからの持ち込みを弾かない）
  const rawList = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { links?: unknown })?.links)
      ? (parsed as { links: unknown[] }).links
      : null;
  if (!rawList) return { links: [], skipped: 0, error: 'リンクの一覧が見つかりませんでした' };

  const links: PortalLinkInput[] = [];
  let skipped = 0;
  for (const raw of rawList.slice(0, MAX_PORTAL_IMPORT_ROWS)) {
    const input =
      typeof raw === 'object' && raw !== null
        ? normalizeLinkInput(raw as Record<string, unknown>)
        : null;
    if (input) links.push(input);
    else skipped++;
  }
  skipped += Math.max(0, rawList.length - MAX_PORTAL_IMPORT_ROWS);

  return { links, skipped };
}
