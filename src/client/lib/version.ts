/**
 * アプリのバージョン。
 *
 * 実体は package.json の `version` で、ビルド時に Vite の `define` で埋め込む。
 * ソースを 2 か所に持つと必ずズレるので、**package.json だけを正**とする。
 *
 * 上げ方は `npm run release`（minor が 1 つ上がる。1.0.0 → 1.1.0）。
 * ビルドのたびに自動で上げることはしない。開発中のビルドでも数字が進んでしまい、
 * 「表示されている番号」と「公開されている中身」の対応が取れなくなるため。
 */

export const APP_VERSION: string = __APP_VERSION__;

/**
 * 表示用に major.minor だけ取り出す（1.0.0 → v1.0）。
 * パッチまで出すと桁が増えてロゴの隣で邪魔になる。
 */
export function formatVersion(version: string): string {
  const [major, minor] = version.split('.');
  if (!major || !/^\d+$/.test(major)) return 'v0.0';
  return `v${major}.${/^\d+$/.test(minor ?? '') ? minor : '0'}`;
}
