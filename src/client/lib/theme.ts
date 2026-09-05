/**
 * テーマ設定の解決。
 *
 * 判定だけを切り出してテストしている。`localStorage` と `matchMedia` を触る側は
 * ThemeProvider に置く（ブラウザ API に依存するのでテストしにくい）。
 */

export const THEME_STORAGE_KEY = 'studyrecall:theme';

/** ユーザーが選べる設定値 */
export type ThemeSetting = 'light' | 'dark' | 'system';
/** 実際に適用する見た目 */
export type ResolvedTheme = 'light' | 'dark';

const SETTINGS: readonly ThemeSetting[] = ['light', 'dark', 'system'];

export function isThemeSetting(value: unknown): value is ThemeSetting {
  return typeof value === 'string' && SETTINGS.includes(value as ThemeSetting);
}

/** 保存値を読む。壊れていたら 'system'（＝OS に従う）へ倒す。 */
export function readStoredTheme(): ThemeSetting {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeSetting(raw) ? raw : 'system';
  } catch {
    // プライベートモード等では読めない
    return 'system';
  }
}

/** 設定と OS の状態から、実際に当てる見た目を決める */
export function resolveTheme(setting: ThemeSetting, systemPrefersDark: boolean): ResolvedTheme {
  if (setting === 'system') return systemPrefersDark ? 'dark' : 'light';
  return setting;
}

/** トグルを 1 つのボタンで回すときの順序 */
export function nextThemeSetting(current: ThemeSetting): ThemeSetting {
  const index = SETTINGS.indexOf(current);
  return SETTINGS[(index + 1) % SETTINGS.length];
}

/** PWA のステータスバー色。ライトは既存のブランド色、ダークは背景に寄せる。 */
export const THEME_COLOR: Record<ResolvedTheme, string> = {
  light: '#2563eb',
  dark: '#020617',
};
