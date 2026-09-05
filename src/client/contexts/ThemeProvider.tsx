import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  THEME_COLOR,
  THEME_STORAGE_KEY,
  nextThemeSetting,
  readStoredTheme,
  resolveTheme,
  type ResolvedTheme,
  type ThemeSetting,
} from '../lib/theme';

/**
 * ダークモードの管理。
 *
 * `<html>` に `dark` クラスを付け外しして Tailwind の `dark:` を効かせる。
 * v4 の `dark:` は既定で prefers-color-scheme を見るので、
 * クラス方式にする宣言（`@custom-variant dark`）が index.css に要る。
 *
 * AuthGate より外に置く。ログイン画面もテーマに従わせたいため。
 */

const DARK_QUERY = '(prefers-color-scheme: dark)';

interface ThemeContextValue {
  setting: ThemeSetting;
  resolved: ResolvedTheme;
  setSetting: (setting: ThemeSetting) => void;
  /** ボタン 1 つで light → dark → system と回す */
  cycle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme は ThemeProvider の中で使ってください');
  return value;
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(DARK_QUERY).matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [setting, setSettingState] = useState<ThemeSetting>(() => readStoredTheme());
  const [systemDark, setSystemDark] = useState<boolean>(() => systemPrefersDark());

  // 'system' のあいだは OS 側の切り替えに追随する
  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY);
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const resolved = resolveTheme(setting, systemDark);

  // クラスの付け外しと、PWA のステータスバー色
  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', THEME_COLOR[resolved]);
  }, [resolved]);

  const setSetting = useCallback((next: ThemeSetting) => {
    setSettingState(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // 保存できなくても今回のセッションでは効くので、そのまま続ける
    }
  }, []);

  // 保存に失敗していても画面の状態は進むので、localStorage ではなく state を見る
  const cycle = useCallback(() => {
    setSetting(nextThemeSetting(setting));
  }, [setSetting, setting]);

  return (
    <ThemeContext.Provider value={{ setting, resolved, setSetting, cycle }}>
      {children}
    </ThemeContext.Provider>
  );
}
