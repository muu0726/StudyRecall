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

KEYS="GEMINI_API_KEY BETTER_AUTH_SECRET GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET"
failed=0

for key in $KEYS; do
  # CRLF 混じりでも壊れないよう \r を落としてから、= 以降を値として取り出し、
  # 前後のダブルクォート/シングルクォートを剥がす。
  value=$(
    tr -d '\r' < .dev.vars \
      | grep -E "^${key}=" \
      | head -1 \
      | cut -d= -f2- \
      | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
  ) || true

  if [ -z "${value}" ]; then
    echo "  スキップ: ${key} が .dev.vars に無いか空です" >&2
    failed=1
    continue
  fi

  # 雛形のプレースホルダをそのまま本番へ送らない
  case "${value}" in
    your-*)
      echo "  スキップ: ${key} が雛形のプレースホルダのままです" >&2
      failed=1
      continue
      ;;
  esac

  # 値は stdin 経由で渡す。コマンドライン引数にすると履歴やプロセス一覧に残る。
  printf '%s' "${value}" | "${WRANGLER}" secret put "${key}" > /dev/null
  echo "  登録: ${key}"
done

if [ "${failed}" -ne 0 ]; then
  echo "一部のキーを登録できませんでした。上のメッセージを確認してください。" >&2
  exit 1
fi

echo
echo "完了。登録済みのキー名は次で確認できます:"
echo "  ./node_modules/.bin/wrangler secret list"
