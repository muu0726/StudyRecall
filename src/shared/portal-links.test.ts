import { describe, expect, it } from 'vitest';
import {
  buildExport,
  categoriesOf,
  filterLinks,
  iconImageOf,
  initialOf,
  normalizeIconDomain,
  normalizeLinkInput,
  normalizeUrl,
  parseImport,
  urlKey,
} from './portal-links';
import type { PortalLinkDTO } from './types';

/**
 * ポータルのリンクは **押すと外へ飛ぶ** ので、URL の検証を落とすと
 * 保存した人の画面で任意のスクリプトが走る。ここが最後の砦。
 */

function link(overrides: Partial<PortalLinkDTO> = {}): PortalLinkDTO {
  return {
    id: 'lnk_1',
    title: 'GitHub',
    url: 'https://github.com/',
    category: '開発',
    iconKind: 'favicon',
    iconValue: '',
    sortOrder: 0,
    createdAt: '2026-09-28T00:00:00.000Z',
    updatedAt: '2026-09-28T00:00:00.000Z',
    ...overrides,
  };
}

describe('normalizeUrl', () => {
  it('スキームが無ければ https を補う', () => {
    expect(normalizeUrl('github.com')).toBe('https://github.com/');
    expect(normalizeUrl('  example.com/path  ')).toBe('https://example.com/path');
  });

  it('http と https はそのまま通す', () => {
    expect(normalizeUrl('http://localhost:5173/x')).toBe('http://localhost:5173/x');
    expect(normalizeUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
  });

  it('スクリプトを仕込める形は通さない', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('JavaScript:alert(1)')).toBeNull();
    expect(normalizeUrl('data:text/html;base64,PHNjcmlwdD4=')).toBeNull();
    expect(normalizeUrl('file:///C:/secret.txt')).toBeNull();
    expect(normalizeUrl('vbscript:msgbox(1)')).toBeNull();
  });

  it('空・長すぎ・文字列でないものは通さない', () => {
    expect(normalizeUrl('')).toBeNull();
    expect(normalizeUrl('   ')).toBeNull();
    expect(normalizeUrl(`https://example.com/${'a'.repeat(2100)}`)).toBeNull();
    expect(normalizeUrl(null)).toBeNull();
    expect(normalizeUrl(42)).toBeNull();
  });
});

describe('normalizeLinkInput', () => {
  it('題名が空ならドメインで埋める', () => {
    expect(normalizeLinkInput({ url: 'github.com', title: '   ' })).toEqual({
      title: 'github.com',
      url: 'https://github.com/',
      category: '',
      iconKind: 'favicon',
      iconValue: '',
    });
  });

  it('絵文字が空の emoji は favicon に落とす（穴あきのアイコンを作らない）', () => {
    const input = normalizeLinkInput({ url: 'example.com', iconKind: 'emoji', iconValue: '' });
    expect(input?.iconKind).toBe('favicon');
  });

  it('画像 URL も検証を通す。だめなら favicon に落とす', () => {
    expect(
      normalizeLinkInput({ url: 'example.com', iconKind: 'image', iconValue: 'javascript:x' })
        ?.iconKind,
    ).toBe('favicon');
    expect(
      normalizeLinkInput({ url: 'example.com', iconKind: 'image', iconValue: 'cdn.test/a.png' }),
    ).toMatchObject({ iconKind: 'image', iconValue: 'https://cdn.test/a.png' });
  });

  it('題名とカテゴリは上限で切る', () => {
    const input = normalizeLinkInput({
      url: 'example.com',
      title: 'あ'.repeat(100),
      category: 'か'.repeat(100),
    });
    expect(input?.title).toHaveLength(60);
    expect(input?.category).toHaveLength(30);
  });

  it('URL がだめなら丸ごと捨てる', () => {
    expect(normalizeLinkInput({ url: 'javascript:alert(1)', title: 'わな' })).toBeNull();
  });
});

describe('urlKey', () => {
  it('www と末尾のスラッシュとスキームの違いは同じものとして扱う', () => {
    expect(urlKey('https://www.github.com/')).toBe(urlKey('http://github.com'));
  });

  it('パスが違えば別物', () => {
    expect(urlKey('https://github.com/a')).not.toBe(urlKey('https://github.com/b'));
  });
});

describe('filterLinks', () => {
  const links = [
    link({ id: '1', title: 'GitHub', url: 'https://github.com/', category: '開発' }),
    link({
      id: '2',
      title: 'ネットワーク早見表',
      url: 'https://example.com/net',
      category: '学習',
    }),
    link({ id: '3', title: 'Figma', url: 'https://figma.com/', category: 'デザイン' }),
  ];

  it('全角・半角・カタカナ・ひらがなの違いを畳む（用語辞書と同じ正規化）', () => {
    expect(filterLinks(links, { query: 'ｷﾞｯﾄﾊﾌﾞ' })).toHaveLength(0);
    expect(filterLinks(links, { query: 'ＧｉｔＨｕｂ' }).map((l) => l.id)).toEqual(['1']);
    expect(filterLinks(links, { query: 'ねっとわーく' }).map((l) => l.id)).toEqual(['2']);
  });

  it('URL の一部でも引ける', () => {
    expect(filterLinks(links, { query: 'figma.com' }).map((l) => l.id)).toEqual(['3']);
  });

  it('カテゴリと検索は重ねて効く', () => {
    expect(filterLinks(links, { category: '開発' }).map((l) => l.id)).toEqual(['1']);
    expect(filterLinks(links, { category: '開発', query: 'figma' })).toHaveLength(0);
  });

  it('空の条件では素通し', () => {
    expect(filterLinks(links)).toHaveLength(3);
  });
});

describe('categoriesOf', () => {
  it('未分類は数えず、登録順のまま件数を出す', () => {
    const result = categoriesOf([
      link({ id: '1', category: '開発' }),
      link({ id: '2', category: '' }),
      link({ id: '3', category: '開発' }),
      link({ id: '4', category: 'ツール' }),
    ]);
    expect(result).toEqual([
      { name: '開発', count: 2 },
      { name: 'ツール', count: 1 },
    ]);
  });
});

describe('iconImageOf / initialOf', () => {
  /* 画面から直接 Google を叩くと、登録したサイトのドメインが利用者ごとに伝わる。中継を通す */
  it('favicon は自分のサーバー（/api/icon）を指す。外部の URL を組み立てない', () => {
    const src = iconImageOf(link());
    expect(src).toBe('/api/icon?domain=github.com&sz=128');
    expect(src).not.toContain('google.com');
  });

  it('ホスト名として変な値は URL を作らない（中継を踏み台にさせない）', () => {
    expect(normalizeIconDomain('example.com')).toBe('example.com');
    expect(normalizeIconDomain('EXAMPLE.com ')).toBe('example.com');
    expect(normalizeIconDomain('example..com')).toBeNull();
    expect(normalizeIconDomain('-example.com')).toBeNull();
    expect(normalizeIconDomain('example.com/../evil')).toBeNull();
    expect(normalizeIconDomain('example.com?x=1')).toBeNull();
    expect(normalizeIconDomain('a'.repeat(300))).toBeNull();
    expect(normalizeIconDomain(null)).toBeNull();
  });

  it('emoji は画像を持たない（頭文字ではなく絵文字を描く側の判断に回す）', () => {
    expect(iconImageOf(link({ iconKind: 'emoji', iconValue: '💻' }))).toBeNull();
  });

  it('頭文字は題名から。題名が無ければドメインから', () => {
    expect(initialOf(link({ title: 'Figma' }))).toBe('F');
    expect(initialOf(link({ title: '' }))).toBe('g');
  });
});

describe('parseImport', () => {
  it('書き出したものをそのまま読み戻せる', () => {
    const json = buildExport([link({ title: 'GitHub', category: '開発' })]);
    const parsed = parseImport(json);
    expect(parsed.error).toBeUndefined();
    expect(parsed.skipped).toBe(0);
    expect(parsed.links).toEqual([
      {
        title: 'GitHub',
        url: 'https://github.com/',
        category: '開発',
        iconKind: 'favicon',
        iconValue: '',
      },
    ]);
  });

  it('配列そのままのファイルも受け取る', () => {
    const parsed = parseImport(JSON.stringify([{ title: 'X', url: 'x.com' }]));
    expect(parsed.links).toHaveLength(1);
  });

  it('壊れた行だけ捨てて、残りは取り込む', () => {
    const parsed = parseImport(
      JSON.stringify({
        links: [
          { title: 'ok', url: 'example.com' },
          { title: 'わな', url: 'javascript:alert(1)' },
          'ただの文字列',
        ],
      }),
    );
    expect(parsed.links).toHaveLength(1);
    expect(parsed.skipped).toBe(2);
  });

  it('JSON でないもの・一覧が無いものは理由を返す', () => {
    expect(parseImport('これはJSONではない').error).toBeTruthy();
    expect(parseImport('{"foo":1}').error).toBeTruthy();
  });

  it('多すぎる行は上限までで切り、切った分を数える', () => {
    const many = Array.from({ length: 520 }, (_, i) => ({ title: `t${i}`, url: `e${i}.com` }));
    const parsed = parseImport(JSON.stringify(many));
    expect(parsed.links).toHaveLength(500);
    expect(parsed.skipped).toBe(20);
  });
});
