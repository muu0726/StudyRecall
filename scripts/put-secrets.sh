#!/usr/bin/env bash
#
# .dev.vars の値を Cloudflare Workers のシークレットとして登録する。
#
#   bash scripts/put-secrets.sh
#
# 値は標準出力に一切出さない（登録できたキー名だけを表示する）。
# .dev.vars は git 管理外なので、このスクリプト自体に秘匿情報は含まれない。
#
# ALLOW_DEV_LOGIN は意図的に対象外。本番では未定義のままにして
# 開発用モックログインを無効にする（wrangler.jsonc のコメントを参照）。
set -euo pipefail

cd "$(dirname "$0")/.."

# npx は使わない。Windows の PowerShell 実行ポリシーが npx.ps1 の読み込みを止めることがあり、
# そこで詰まると原因が分かりにくい。ローカルにインストール済みの wrangler を直接叩く。
WRANGLER="./node_modules/.bin/wrangler"
if [ ! -x "${WRANGLER}" ]; then
  echo "エラー: ${WRANGLER} が見つかりません。先に npm install を実行してください。" >&2
  exit 1
fi

if [ ! -f .dev.vars ]; then
  echo "エラー: .dev.vars が見つかりません。.dev.vars.example をコピーして作成してください。" >&2
  exit 1
fi

# `wrangler secret put` は使えない。
# stdin から値を流す形だと wrangler が「非対話環境」と判断し、OAuth ログイン済みでも
#   「CLOUDFLARE_API_TOKEN を設定しろ」
# と言って止まる（deploy や secret list は同じ条件でも通るのに、secret put だけが拒否する）。
# ファイルを読む `secret bulk` は非対話でも通るので、こちらを使う。
TMP_JSON="$(mktemp)"
# 途中で失敗しても平文の JSON を残さない
trap 'rm -f "${TMP_JSON}"' EXIT INT TERM

# JSON の組み立ては node に任せる。値にクォートやバックスラッシュが入っていても壊れない。
node - "${TMP_JSON}" <<'NODE'
const fs = require('fs');
const out = process.argv[2];
const KEYS = ['GEMINI_API_KEY', 'BETTER_AUTH_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];

// CRLF 混じりでも壊れないよう \r を落としてから読む
const lines = fs.readFileSync('.dev.vars', 'utf8').replace(/\r/g, '').split('\n');
const secrets = {};
const problems = [];

for (const key of KEYS) {
  const line = lines.find((l) => l.startsWith(key + '='));
  let value = line === undefined ? '' : line.slice(key.length + 1).trim();
  // 前後のクォートを剥がす
  const quoted = /^(["'])(.*)\1$/.exec(value);
  if (quoted) value = quoted[2];

  if (value === '') problems.push(`${key}: .dev.vars に無いか空です`);
  else if (value.startsWith('your-')) problems.push(`${key}: 雛形のプレースホルダのままです`);
  else secrets[key] = value;
}

if (problems.length > 0) {
  // 値そのものは絶対に出さない。キー名と理由だけ。
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}

fs.writeFileSync(out, JSON.stringify(secrets), { mode: 0o600 });
console.log('登録するキー: ' + Object.keys(secrets).join(', '));
NODE

"${WRANGLER}" secret bulk "${TMP_JSON}"

echo
echo "完了。登録済みのキー名は次で確認できます:"
echo "  ./node_modules/.bin/wrangler secret list"
