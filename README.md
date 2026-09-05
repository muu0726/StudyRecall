# StudyRecall

学習時間を記録すると、その日の「学びメモ」から Gemini が自動で一問一答（フラッシュカード）を生成し、そのまま復習できる Web アプリ。
Markdown ノートや用語のクイック追加からも問題を作れて、AI が付けたジャンルタグで絞り込み出題できる。

## 技術スタック

- **Cloudflare Workers** + **Vite (React 19 / TypeScript)** — `@cloudflare/vite-plugin` で統合
- **Hono** — API ルーティング
- **Cloudflare D1** + **Drizzle ORM** — 分散 SQLite
- **Better Auth** — Google OAuth によるマルチデバイス認証
- **Google Gemini API** (`gemini-3.6-flash`) — Structured Outputs で一問一答とタグを生成
- **Tailwind CSS v4** + **lucide-react** + **react-markdown / remark-gfm**
- **vite-plugin-pwa** — ホーム画面から全画面起動
- **jszip** / **canvas-confetti** — ノートの ZIP 出力と達成演出
- **Web Speech API** / **Web Audio API** — 読み上げ、集中サウンド、アラーム（依存追加なし）

## セットアップ

```bash
npm install
```

`.dev.vars.example` をコピーして `.dev.vars` を作り、値を設定する。

```
GEMINI_API_KEY=...            # https://aistudio.google.com/apikey
BETTER_AUTH_SECRET=...        # openssl rand -base64 32 などで生成（32文字以上）
GOOGLE_CLIENT_ID=...          # 下記の手順で取得
GOOGLE_CLIENT_SECRET=...
```

ローカル D1 を初期化する（デモユーザーと初期カテゴリ3件がシードされる）。

```bash
npm run db:migrate:local
```

開発サーバーを起動する。

```bash
npm run dev
```

http://localhost:5173 で起動する。Vite と Workers ランタイム（workerd）が同一プロセスで動くため、ローカル D1 バインディングもそのまま効く。

### Google OAuth クライアントの作成

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) で「認証情報を作成」→「OAuth クライアント ID」
2. アプリケーションの種類は「ウェブ アプリケーション」
3. **承認済みのリダイレクト URI** に次を追加する
   - ローカル: `http://localhost:5173/api/auth/callback/google`
   - 本番: `https://<your-domain>/api/auth/callback/google`
4. 発行されたクライアント ID / シークレットを `.dev.vars` に設定する

未設定のあいだはログイン画面の Google ボタンが無効になり、代わりに**開発用モックログイン**が使える
（`.dev.vars` の `ALLOW_DEV_LOGIN=true` のときだけ表示される）。

> **`ALLOW_DEV_LOGIN` は `wrangler.jsonc` に書かない。** このファイルは Workers Builds が
> 本番ビルドでもそのまま使うため、ここに `"true"` を置くとモックログインが本番へ漏れる。
> `.dev.vars`（git 管理外）にだけ置き、本番は**未定義＝無効**という安全側の既定にしている。
> `"false"` と書き換えないのは、`wrangler types` が vars をリテラル型で吐くせいで
> `env.ALLOW_DEV_LOGIN === 'true'` が「重ならない型の比較」で型エラーになるため。

## デプロイ

本番: **https://study-recall.u-muta180726.workers.dev**（Cloudflare Workers + リモート D1 / APAC）

初回だけ次の順に行う。**順番に意味がある** — Google の設定は URL が確定するまで登録できない。

```bash
# 1. Cloudflare にログイン（ブラウザで OAuth 同意）
npx wrangler login

# 2. リモート D1 を作り、出た database_id を wrangler.jsonc に書く
npx wrangler d1 create study-recall-db

# 3. マイグレーションを本番へ適用
npm run db:migrate:remote

# 4. デプロイ（ここで本番 URL が確定する）
npm run deploy

# 5. シークレット 4 件を投入（値は画面に出ない）
bash scripts/put-secrets.sh
```

6. Google Cloud Console の OAuth クライアントに本番 URL を追加する
   - 承認済みの JavaScript 生成元: `https://<worker>.workers.dev`
   - 承認済みのリダイレクト URI: `https://<worker>.workers.dev/api/auth/callback/google`

以後は `git push` で **Cloudflare Workers Builds** が自動デプロイする
（Build command `npm run build` / Deploy command `npx wrangler deploy`）。
**マイグレーションは自動では流れない。** スキーマを変えたときだけ `npm run db:migrate:remote` を手で流す。
push のたびに DDL が走ると、失敗したときにデプロイごと巻き添えで止まるため。

### 詰まりやすい点

- **`wrangler secret put` は非対話環境で使えない。** 値を stdin から流すと wrangler が
  「非対話」と判断し、OAuth ログイン済みでも `CLOUDFLARE_API_TOKEN` を要求して止まる
  （`deploy` や `secret list` は同じ条件で通るのに `secret put` だけが拒否する）。
  `scripts/put-secrets.sh` はファイルを読む **`secret bulk`** を使ってこれを回避している。
  一時 JSON は `mktemp` に mode 0600 で書き、`trap` で必ず消す
- **Windows の PowerShell では `npx` が実行ポリシーに弾かれることがある**
  （`npx.ps1` が `UnauthorizedAccess`）。`npx.cmd` を使うか、Git Bash から実行する。
  `scripts/put-secrets.sh` は `./node_modules/.bin/wrangler` を直接叩いて npx を経由しない
- **PowerShell の `bash` は WSL の bash**（`C:\Windows\System32\bash.exe`）。
  Git Bash を使うならフルパスで指定する: `& "C:\Program Files\Git\bin\bash.exe" scripts/put-secrets.sh`
- **`database_id` を差し替えるとローカル開発 DB が別ファイルになる。**
  `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/<hash>.sqlite` が ID ごとに分かれるため。
  引き継ぐなら dev サーバーを止めて（WAL をチェックポイントさせて）から旧ファイルをコピーする。
  停止前にコピーすると WAL 側の更新が抜ける

### 公開範囲についての注意

workers.dev の URL は誰でも開ける。**アクセス制限を掛けていないので、URL を知った第三者が
自分の Google アカウントで登録でき、その人の問題生成が `GEMINI_API_KEY` の持ち主に課金される。**
Google AI Studio 側で使用量アラートを設定しておくとよい。
制限するなら Better Auth の `databaseHooks.user.create.before` で許可メール以外を弾くのが素直。

## npm scripts

| script | 内容 |
| --- | --- |
| `dev` | 開発サーバー起動 |
| `build` | 型チェック＋本番ビルド（PWA の SW も生成される） |
| `preview` | ビルドしてローカルで本番相当の動作確認 |
| `typecheck` | `tsc -b` のみ実行 |
| `db:generate` | スキーマ変更から migrations の SQL を生成 |
| `db:migrate:local` | ローカル D1 にマイグレーションを適用 |
| `db:migrate:remote` | リモート D1 にマイグレーションを適用 |
| `cf-typegen` | `wrangler.jsonc` から `worker-configuration.d.ts` を再生成 |

## 画面構成

上部タブは廃し、**左サイドバーに集約**している（Notion / Linear 風）。

- **ヘッダー** — ロゴと「＋ 用語を追加」。用語追加はどの画面からでも開ける
- **ナビゲーション** — タイマー & ポモドーロ / ノートブック / フラッシュカード復習 / ダッシュボード
- **ノートのファイルツリー** — カテゴリをフォルダとした VS Code 風のエクスプローラー。
  ここから直接ノートを開き、作り、動かし、消す（**メイン画面に一覧ペインは無い**）
- **ジャンル** — AI が付けたタグの一覧。押すと**そのタグで絞り込んだ復習画面へ直行**する
  （同じタグをもう一度押すと絞り込みを解除）
- **フッター** — データエクスポート（Anki CSV / 全ノート ZIP）、カテゴリ管理、ログイン中のユーザー

レスポンシブの切り替えは `md`（768px）を境にする。

| | PC（`md:` 以上） | モバイル（`md:` 未満） |
| --- | --- | --- |
| サイドバー | 常時表示・幅 260px | 既定は非表示。ハンバーガーでドロワー |
| 折りたたみ | アイコンのみ（64px）にできる。状態は localStorage | 効かせない（狭い画面でアイコンだけ出しても意味がないため） |
| 閉じる | — | 項目の選択 / 背景タップ / Escape |

開いていた画面（`studyrecall:view`）と折りたたみ状態（`studyrecall:sidebar-collapsed`）は
localStorage に保存し、次回も復元する。スクロールするのは右側のコンテンツ領域だけで、
サイドバーは常に見えたままになる。

**同じものを 2 か所が描くなら、状態は `App` が持つ。**

- サイドバーのジャンルと復習画面のチップは同じタグを指す → カテゴリ・タグは `App` が持ち `ReviewTab` へ渡す
- サイドバーのツリーとノート画面は同じノートを指す → ノート一覧と選択は `useNotebooks`（`App` が呼ぶ）が持つ

どちらか一方に閉じ込めると、片方を操作しても他方が更新されないズレが必ず出る。

## ディレクトリ構成

```
src/
├─ db/schema.ts       Drizzle スキーマ（スキーマの唯一の真実）
├─ shared/types.ts    API の入出力型。client / worker 双方から import
├─ worker/            Hono API（Cloudflare Workers 上で動く）
│  ├─ routes/         categories / study-logs / quizzes / notebooks / tags / timer
│  └─ lib/            auth, gemini（生成）, time（JST 日境界）, db, dto, queries, ids
└─ client/            React SPA
   ├─ components/     AuthGate / Sidebar（ナビ・ノートツリー・ジャンル・ツール・アカウント）
   │                  NoteTree / MoveNoteDialog
   │                  StudyTab / NotesTab / ReviewTab / StatsTab
   │                  RecordModal / AddTermModal / FlashCard / MarkdownView
   │                  CategoryManagerModal / ConfirmDialog / ConflictDialog / Toast
   ├─ hooks/          useTimer（サーバー同期）/ useRevalidateOnFocus / useNotebooks
   └─ lib/            api（fetch ラッパ・ApiError/NetworkError）, offline-queue,
                      auth-client, format, cn
scripts/
└─ generate-icons.mjs PWA アイコンの生成（依存なし。public/ の PNG を作り直す）
```

## API

| メソッド | パス | 認証 | 内容 |
| --- | --- | --- | --- |
| GET | `/api/auth-config` | 不要 | ログイン画面が出す手段（Google / モック）の可否 |
| POST | `/api/auth/dev-login` | 不要 | 開発用モックログイン（`ALLOW_DEV_LOGIN=true` のときだけ） |
| GET/POST | `/api/auth/*` | 不要 | Better Auth（Google OAuth・セッション・サインアウト） |
| GET | `/api/categories` | 必要 | カテゴリ一覧 |
| POST | `/api/categories` | 必要 | カテゴリ作成 `{ name, color? }` |
| GET | `/api/study-logs` | 必要 | 学習履歴＋統計（今日/今週/科目別/習得率） |
| POST | `/api/study-logs` | 必要 | 記録保存＋問題生成 `{ categoryId, durationMinutes, notes, timerSessionId? }` |
| GET | `/api/quizzes` | 必要 | `?categoryId=&tag=&notebookId=&unmasteredOnly=` で絞り込み（すべて AND） |
| POST | `/api/quizzes/manual-add` | 必要 | 用語から1問生成 `{ categoryId, term, description }` |
| POST | `/api/quizzes/:id/result` | 必要 | 判定を記録 `{ correct: boolean }` |
| GET | `/api/tags` | 必要 | 使用中のジャンルタグと問題数 |
| PUT/DELETE | `/api/categories/:id` | 必要 | カテゴリの改名・色変更 / 削除（使用中は 409） |
| GET | `/api/timer` | 必要 | 稼働中タイマー（サーバーが `elapsedMs` を算出） |
| POST | `/api/timer/start\|pause\|resume\|reset` | 必要 | タイマー操作。start は `{ mode }`（free / pomodoro）。既存セッションがあれば合流する |
| GET/POST | `/api/notebooks` | 必要 | ノート一覧（フラット配列。ツリー化は描画側）/ 作成（`parentId` 可） |
| POST | `/api/notebooks/:id/move` | 必要 | ツリー内の移動 `{ parentId, index, categoryId? }` |
| PUT/DELETE | `/api/notebooks/:id` | 必要 | ノート更新（`expectedUpdatedAt` 必須、競合は 409）/ 削除（子孫ごと。件数を返す） |
| POST | `/api/notebooks/:id/generate-quiz` | 必要 | ノート本文から生成 `{ count?: 1〜10 }` |
| GET | `/api/stats/heatmap` | 必要 | 過去365日の日別集計（JST）＋ストリーク |

## マルチデバイス同期

PC・スマホ・タブレットで同時に開いても壊れないよう、次の4つを入れてある。

1. **フォーカス復帰で自動再取得** — `src/client/hooks/useRevalidateOnFocus.ts`。
   `focus` / `visibilitychange` / `online` を購読し、直近の取得から 30 秒以上経っていれば裏で取り直す。
   **編集中のノートの下書きは上書きしない**（サーバー側が新しければバナーで知らせるだけ）。
2. **ノートの楽観的ロック** — 保存時に読み込み時点の `updatedAt` を送り、サーバーは条件付き UPDATE で
   照合する。ずれていたら 409 と最新内容を返し、UI が「破棄して読み込む / 強制上書き / キャンセル」を出す。
3. **タイマーのサーバー同期** — `timer_sessions` テーブルが真実の情報源。全端末が同じセッションを共有し、
   確定は条件付き UPDATE で先着一回だけ通る。他端末が先に確定していたら通知してタイマーを畳む。
4. **オフライン復帰** — `src/client/lib/offline-queue.ts`。通信断のときだけ判定を localStorage に積み、
   復帰時に自動再送する。サーバーが拒否した（4xx/5xx）ものは積まない。

## 学習を続けるための仕掛け

- **ハンズフリー音声復習**（フラッシュカード復習）— 問題文 → シンキングタイム（3秒 / 5秒）→ 解答と解説 → 次、を
  自動で進める。速度は 0.8〜1.5x。`src/client/hooks/useSpeechQueue.ts`
- **ヒートマップ**（ダッシュボード）— GitHub 風のグリッド。API は常に365日分を返し、
  表示週数は画面幅で切り替える（PC=53週 / モバイル=27週）。連続学習日数も表示する
- **ポモドーロ**（タイマー）— 25分集中 / 5分休憩。フェーズ切替でビープが鳴る
- **集中サウンド** — ホワイトノイズ / 雨音（ブラウンノイズ）。Web Audio API で生成するので音源ファイル不要

## ノートのツリー構造

Notion のようにノートを入れ子にできる。`notebooks.parentId`（隣接リスト）と `sortOrder` で表現する。

- **カテゴリが最上位** — サイドバーは「カテゴリ > ノート > 子ノート」。**子は必ず親と同じカテゴリを持つ**
  という不変条件を保つため、移動すると部分木のカテゴリがまとめて書き換わる
- **深さの上限は 5 階層**、**循環は禁止**（自分自身や子孫の下へは移せない）。
  判定ロジックは `src/shared/note-tree.ts` に置き、**サーバーとクライアントで同じ規則**を使う
  （UI では落とせるのに 400 が返る、というズレを作らないため）
- **移動は DnD とメニューの両方** — 行の上下 25% で兄弟として挿入、中央で子にする。
  モバイルは ⋯ メニューの「移動」から選ぶ
- **開閉状態は localStorage に保存**して次回も復元する。
  ノートは「開いている id」を、カテゴリは**「閉じている id」**を保存する
  （カテゴリは既定で開くべきなので、逆に持つと新しいカテゴリが勝手に畳まれる）
- **親を消すと子孫も消える**。確認ダイアログに件数を出す
- **移動でカテゴリが変わってもエディタは黙って追随する**。カテゴリは構造（ツリー）が正で、
  本文と同じ「未保存の変更」として扱うと、自分で移動しただけで競合警告が出てしまう

> **`window.confirm()` は使わない。** ブラウザが「このページでこれ以上ダイアログを表示しない」で
> 抑制すると、以降は無言で `false` が返り、**削除が何も起きずに失敗する**。
> 確認は `src/client/components/ConfirmDialog.tsx`（アプリ内モーダル）で行う。

## エクスポート

出口は 2 か所ある。**サイドバー下部は全件**、**復習画面のボタンは表示中の絞り込みだけ**。
片方に寄せると「全部欲しい」「この条件だけ欲しい」のどちらかが必ず不便になるので、両方残している。

- **Anki 用 CSV** — 表面 / 裏面（解答 `<br><br>` 解説）/ タグ の3列。
  Anki はフィールドを HTML として読むので改行タグがそのまま効く。BOM は付けない（1列目が壊れるため）。
  復習画面の「この条件をAnki出力」は**現在の絞り込み結果**で、件数をボタンに出している
- **Markdown ZIP** — ツリーをそのままフォルダにした `カテゴリ名/親/子.md` の構造。
  YAML フロントマター（`title` / `category` / `parent` / `created` / `updated`）付き

## 設計上の注意点

- **統計の日境界は JST 固定**。Worker は UTC で動くため、`src/worker/lib/time.ts` で UTC+9 のオフセットを明示的に計算している。これがないと深夜の記録が前日/翌日にズレる。
- **問題生成の失敗は保存を巻き込まない**。`GEMINI_API_KEY` 未設定・API エラー・パース失敗のいずれでも学習記録やノートは保存され、`warning` が返る（用語のクイック追加だけは生成が本体なので、失敗時は保存しない）。
- **LLM 出力は防御的にパースする**。Structured Outputs を使っていても、`src/worker/lib/gemini.ts` でコードフェンス除去と `{...}` 抽出のフォールバックを通し、タグを含む各フィールドを実行時に検証している。
- **Gemini 3 系は `thinkingBudget` を受け付けない**。`thinkingLevel`（MINIMAL/LOW/…）を使う。`thinkingBudget` を渡すと 400 になる。
- **Better Auth のインスタンスはリクエストごとに生成する**。Workers では env バインディングがリクエスト単位でしか取れないため、モジュールトップでは作れない。
- **`accounts.issuer` は必須**。Better Auth 1.7 の `signInEmail` は `providerId='credential'` かつ `issuer='local:credential'` かつ `accountId===user.id` のアカウントを探す。どれか欠けると "User not found" になる。
- **D1 には対話的トランザクションが無い**。排他が要るところ（タイマーの確定、ノートの保存）は
  「読んでから書く」ではなく **条件付き UPDATE の返り件数で勝者を決める**（compare-and-swap）。
- **`notebooks` のタイムスタンプはミリ秒**（`timestamp_ms`）。秒精度だと「最後の更新と同じ秒内に
  2端末が保存」したときに競合を取りこぼす。他テーブルは秒のままなので混同しないこと。
- **カテゴリは使用中だと削除できない**。消すと学習記録・ノート・問題まで cascade で失われるため、
  件数を示して拒否する。
- **ポモドーロのフェーズは `elapsedMs` から導出する**。サーバーに持たせているのは `mode` の 1 列だけ。
  全端末が同じ経過時間を見るので、フェーズも残り時間もアラームのタイミングも自動的に揃う。
- **ポモドーロで記録する学習時間は休憩を除いた集中時間**。25分×2 + 休憩5分 = 経過55分なら 50分を記録する
  （`src/client/lib/pomodoro.ts` の `toRecordedMinutes`）。
- **`speechSynthesis` はタブ非表示や画面消灯で止まる**（特に iOS Safari）。Chrome の15秒打ち切り対策として
  `pause()`/`resume()` の keep-alive を入れているが、**画面消灯中の継続は保証できない**。UI にもその旨を明示している。
- **ヒートマップの集計は JST 固定**。`date(x, 'unixepoch', '+9 hours')` で日付キーを作る。
  `study_logs.createdAt` と `quiz_questions.lastAnsweredAt` は集計軸が違うので、別々に畳んでから日付でマージする。
- **ノートの階層は隣接リスト（`parentId`）で持ち、部分木の走査はアプリ側で行う**。
  D1 の再帰 CTE や自己参照 FK の cascade に依存しない（深さ上限があるので走査コストは小さい）。
  削除も子孫 ID を自分で集めてから一括 DELETE する。
- **子ノートのカテゴリは直接変更できない**（`PUT` は 400 を返す）。親に従うため、移動で変える。
- **習得判定**: 「わかった」累計 3 回で習得済み。「まだ不安」で取り消す。カウントは SQL 側でインクリメントする。
- **ノートを削除しても生成済みの問題は残る**（`notebook_id` が `ON DELETE SET NULL`）。復習資産を巻き込んで消さないため。
- **PWA アイコンはプレースホルダ**。`node scripts/generate-icons.mjs` で作り直せる。ブランドアイコンが用意できたら `public/` の PNG を差し替える。

## D1 マイグレーションの落とし穴

SQLite は列の NOT NULL 変更ができないため、drizzle-kit は「テーブル再作成」のマイグレーションを生成する。
これを D1 でそのまま流すと壊れるので、生成後に必ず SQL を目視すること。

- **`timestamp` ⇄ `timestamp_ms` の変更は DDL 差分が出ない**。どちらも SQL 上は `integer` なので
  drizzle-kit は何も生成しない。既存行の変換は手書きマイグレーションが要る（`0005_notebook_ms_timestamps.sql`）。

- **`DROP TABLE users` は `ON DELETE CASCADE` を伝播させて子テーブルを消す**。`PRAGMA defer_foreign_keys` は制約チェックを遅らせるだけで、カスケード削除は止められない。`users` のような親テーブルは再作成せず `ALTER TABLE ... ADD COLUMN` で拡張する。
- **`assets.not_found_handling: "single-page-application"` は Worker より先にアセットを返す**。
  トップレベル遷移（OAuth コールバックなど）が index.html に吸われて Worker に届かなくなるため、
  `"run_worker_first": ["/api/*"]` が必須。fetch/XHR は影響を受けないので、**OAuth だけが壊れて気付きにくい**。
- **`PRAGMA foreign_keys=OFF/ON` は D1 が受け付けない**。参照されていないテーブルの再作成なら、そもそも不要なので削除する。
- **`ADD COLUMN ... NOT NULL` は DEFAULT が必須**。既定値を与えてから `UPDATE` で埋める。
- 再作成の `INSERT ... SELECT` は、旧テーブルにまだ無い新規カラムまで SELECT してくるため、リテラルに書き換える。

## スコープ外

リモート D1・本番デプロイ / リアルタイム同期（WebSocket・SSE でのプッシュ）/ ノートの自動保存・
バージョン履歴・3-way マージ（競合時は「破棄 or 強制上書き」の二択）/ オフライン時のノート編集キュー
（判定のみ対象）/ SRS（間隔反復）/ ダークモード / 自動テスト / タグの表記ゆれ正規化（trim と重複除去のみ）
