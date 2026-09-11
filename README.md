# StudyRecall

学習時間を記録すると、その日の「学びメモ」から Gemini が**資格試験と同じ体裁の 4 択問題**を自動で作り、そのまま復習できる Web アプリ。
Markdown ノートや**用語辞書**からも問題を作れて、AI が付けたジャンルタグで絞り込み出題できる。
カテゴリに対象の資格試験名（例: 基本情報技術者試験）を入れておくと、出題の粒度がその試験に寄る。

Google と連携すると、タスクとカレンダーを同期し、D1 の中身・ノート・用語辞書を
Google ドライブへ書き出せる。

## 技術スタック

- **Cloudflare Workers** + **Vite (React 19 / TypeScript)** — `@cloudflare/vite-plugin` で統合
- **Hono** — API ルーティング
- **Cloudflare D1** + **Drizzle ORM** — 分散 SQLite
- **Better Auth** — Google OAuth によるマルチデバイス認証
- **Google Gemini API** (`gemini-3.6-flash`) — Structured Outputs で 4 択問題とタグを生成
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

> **デプロイ後は「新しいバージョンがあります」のトーストが出る。** `registerType: 'prompt'`。
> 以前は `'autoUpdate'` で、更新が当たるのが次の読み込みからだったため
> 「デプロイしたのに変わらない」という状態になっていた。

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

| script              | 内容                                                       |
| ------------------- | ---------------------------------------------------------- |
| `dev`               | 開発サーバー起動                                           |
| `build`             | 型チェック＋本番ビルド（PWA の SW も生成される）           |
| `preview`           | ビルドしてローカルで本番相当の動作確認                     |
| `typecheck`         | `tsc -b` のみ実行                                          |
| `db:generate`       | スキーマ変更から migrations の SQL を生成                  |
| `db:migrate:local`  | ローカル D1 にマイグレーションを適用                       |
| `db:migrate:remote` | リモート D1 にマイグレーションを適用                       |
| `test`              | Vitest を 1 回実行（純粋関数のみ対象）                     |
| `test:watch`        | Vitest をウォッチ実行                                      |
| `cf-typegen`        | `wrangler.jsonc` から `worker-configuration.d.ts` を再生成 |

## 画面構成

上部タブは廃し、**左サイドバーに集約**している（Notion / Linear 風）。

- **ヘッダー** — ロゴと「＋ 用語を追加」。押すと用語辞書へ移動して登録ダイアログが開く
- **ナビゲーション** — タイマー & ポモドーロ / ノートブック / タスク / 用語辞書 /
  フラッシュカード復習 / ダッシュボード
- **ノートのファイルツリー** — カテゴリをフォルダとした VS Code 風のエクスプローラー。
  ここから直接ノートを開き、作り、動かし、消す（**メイン画面に一覧ペインは無い**）
- **ジャンル** — AI が付けたタグの一覧。押すと**そのタグで絞り込んだ復習画面へ直行**する
  （同じタグをもう一度押すと絞り込みを解除）
- **フッター** — データエクスポート（Anki CSV / 全ノート ZIP）、カテゴリ管理、ログイン中のユーザー

レスポンシブの切り替えは `md`（768px）を境にする。

|            | PC（`md:` 以上）                                  | モバイル（`md:` 未満）                                     |
| ---------- | ------------------------------------------------- | ---------------------------------------------------------- |
| サイドバー | 常時表示・幅 260px                                | 既定は非表示。ハンバーガーでドロワー                       |
| 折りたたみ | アイコンのみ（64px）にできる。状態は localStorage | 効かせない（狭い画面でアイコンだけ出しても意味がないため） |
| 閉じる     | —                                                 | 項目の選択 / 背景タップ / Escape                           |

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
├─ shared/            client / worker 双方から import する純粋な層。**判断はここに寄せる**
│                     types（API の入出力型）/ srs / note-tree / note-sanitize / note-export
│                     note-sync / backup / calendar-event / calendar-view
│                     glossary-search / glossary-mastery / glossary-export / glossary-bulk
│                     cloze / choices
├─ worker/            Hono API（Cloudflare Workers 上で動く）
│  ├─ routes/         categories / study-logs / quizzes / notebooks / tags / timer / stats
│  │                  tasks / calendar / integrations / backup / glossary
│  └─ lib/            auth, google-auth（トークンとスコープ）, google-drive, google-tasks
│                     gemini（生成・補完）, note-mirror, glossary-mirror, backup-data
│                     quota, quiz-insert / glossary-insert（D1 のバインド上限）, time（JST 日境界）
│                     db, dto, queries, ids, user-settings
└─ client/            React SPA
   ├─ components/     AuthGate / Sidebar（ナビ・ノートツリー・ジャンル・ツール・アカウント）
   │                  NoteTree / MoveNoteDialog / NoteTabs / NotesTab / NoteEditor / SplitDivider
   │                  StudyTab / TasksTab / GlossaryTab / ReviewTab / StatsTab
   │                  GlossaryTermCard / GlossaryTermModal / GenerateFromGlossaryModal
   │                  GlossaryQuickAddPopover / GlossaryBulkAddModal
   │                  IntegrationsModal / RestoreBackupDialog
   │                  FlashCard / MarkdownView / SpeechPlayer / Toast ほかダイアログ群
   ├─ hooks/          useTimer / useRevalidateOnFocus / useNotebooks / useNoteTabs
   │                  useNoteSaver / useTasks / useGlossary / useGlossaryDriveSync
   │                  useSpeechQueue / useElementWidth
   ├─ ui/             プリミティブ（Button / Modal / Popover / Segmented / Field /
   │                  SearchInput / TagInput / FilterMenu / Banner / Card / EmptyState）
   └─ lib/            api（fetch ラッパ・ApiError/NetworkError）, offline-queue,
                      markdown-edit, note-selection, remark-mark, remark-glossary,
                      tag-input, glossary-bulk-parse, note-draft, note-tabs, auth-client, format, cn
scripts/
└─ generate-icons.mjs PWA アイコンの生成（依存なし。public/ の PNG を作り直す）
```

## API

| メソッド   | パス                                     | 認証 | 内容                                                                                     |
| ---------- | ---------------------------------------- | ---- | ---------------------------------------------------------------------------------------- |
| GET        | `/api/auth-config`                       | 不要 | ログイン画面が出す手段（Google / モック）の可否                                          |
| POST       | `/api/auth/dev-login`                    | 不要 | 開発用モックログイン（`ALLOW_DEV_LOGIN=true` のときだけ）                                |
| GET/POST   | `/api/auth/*`                            | 不要 | Better Auth（Google OAuth・セッション・サインアウト）                                    |
| GET        | `/api/categories`                        | 必要 | カテゴリ一覧                                                                             |
| POST       | `/api/categories`                        | 必要 | カテゴリ作成 `{ name, color?, examName? }`                                               |
| GET        | `/api/study-logs`                        | 必要 | 学習履歴＋統計（今日/今週/科目別/習得率）                                                |
| POST       | `/api/study-logs`                        | 必要 | 記録保存＋問題生成 `{ categoryId, durationMinutes, notes, timerSessionId? }`             |
| GET        | `/api/quizzes`                           | 必要 | `?categoryId=&tag=&notebookId=&unmasteredOnly=` で絞り込み（すべて AND）                 |
| POST       | `/api/quizzes/:id/result`                | 必要 | 判定を記録 `{ correct: boolean }`                                                        |
| GET        | `/api/tags`                              | 必要 | 使用中のジャンルタグと問題数                                                             |
| PUT/DELETE | `/api/categories/:id`                    | 必要 | カテゴリの改名・色・試験名の変更（`examName: ''` で消す）/ 削除（使用中は 409）          |
| GET        | `/api/timer`                             | 必要 | 稼働中タイマー（サーバーが `elapsedMs` を算出）                                          |
| POST       | `/api/timer/start\|pause\|resume\|reset` | 必要 | タイマー操作。start は `{ mode }`（free / pomodoro）。既存セッションがあれば合流する     |
| GET/POST   | `/api/notebooks`                         | 必要 | ノート一覧（フラット配列。ツリー化は描画側）/ 作成（`parentId` 可）                      |
| POST       | `/api/notebooks/:id/move`                | 必要 | ツリー内の移動 `{ parentId, index, categoryId? }`                                        |
| PUT/DELETE | `/api/notebooks/:id`                     | 必要 | ノート更新（`expectedUpdatedAt` 必須、競合は 409）/ 削除（子孫ごと。件数を返す）         |
| POST       | `/api/notebooks/:id/generate-quiz`       | 必要 | ノート本文から生成 `{ count?: 1〜10 }`                                                   |
| GET        | `/api/stats/heatmap`                     | 必要 | 過去365日の日別集計（JST）＋ストリーク                                                   |
| GET/POST   | `/api/tasks`                             | 必要 | タスク一覧 / 作成。Google Tasks と双方向同期                                             |
| PUT/DELETE | `/api/tasks/:id`                         | 必要 | タスク更新 / 削除（墓標を残してから Google 側を消す）                                    |
| POST       | `/api/tasks/sync`                        | 必要 | Google Tasks と突き合わせる                                                              |
| GET        | `/api/calendar/events`                   | 必要 | 予定一覧 `?from=&to=`（`singleEvents=true` で繰り返しも展開）                            |
| POST       | `/api/calendar/events`                   | 必要 | 予定を作る                                                                               |
| PUT/DELETE | `/api/calendar/events/:id`               | 必要 | 予定の更新（PATCH で送る）/ 削除                                                         |
| GET/PUT    | `/api/integrations`                      | 必要 | 連携の状態と設定（付与済みスコープ、各同期の ON/OFF）                                    |
| POST       | `/api/backup/run`                        | 必要 | D1 の中身を JSON でドライブへ。`{ auto: true }` は 1 日 1 回                             |
| GET        | `/api/backup/snapshot`                   | 必要 | いまの中身を JSON で返す（ドライブを使わない）                                           |
| GET        | `/api/backup/files`                      | 必要 | ドライブ上のバックアップ一覧                                                             |
| POST       | `/api/backup/restore`                    | 必要 | **中身を置き換える**。先に安全用バックアップを取り、取れなければ中止する                 |
| POST       | `/api/backup/notes`                      | 必要 | ノートを `.md` としてドライブへミラー（一方通行）                                        |
| GET        | `/api/glossary`                          | 必要 | 用語一覧 `?categoryId=&tag=`（検索と習得ステータスは**クライアント側**）                 |
| POST       | `/api/glossary`                          | 必要 | 用語登録。同カテゴリの重複は 409 で既存を返す                                            |
| PUT/DELETE | `/api/glossary/:id`                      | 必要 | 用語更新 / 削除（`?cards=keep\|delete`。既定はカードを残す）                             |
| POST       | `/api/glossary/ai-assist`                | 必要 | 意味とタグを補完 `{ categoryId, term, definition? }`。**保存しない**                     |
| POST       | `/api/glossary/bulk`                     | 必要 | まとめて登録 `{ categoryId, terms }`（最大 100 件）。**常に 201**で登録数と飛ばした理由  |
| POST       | `/api/glossary/bulk/ai-assist`           | 必要 | 空の意味をまとめて補完 `{ categoryId, terms }`（最大 20 件）。**保存しない**。上限は 429 |
| POST       | `/api/glossary/generate-cards`           | 必要 | 用語から 4 択を作る `{ termIds }`                                                        |
| POST       | `/api/glossary/sync-drive`               | 必要 | 用語辞書をドライブへ書き出す（`{ auto: true }` は 5 分の床つき）                         |

## 用語辞書

「用語を追加」はもともと辞書ではなかった。用語と説明を Gemini に渡して問題を 1 問作り、
**元の用語と説明を捨てていた**。作り直す材料が残らないし、生成が失敗すれば入力ごと消えた。
`glossary_terms` に用語そのものを残し、そこから何度でも出題を作れるようにしてある。

### 習得ステータスは列に持たない

`未習得 / 復習中 / マスター` は、その用語から作ったカードの状態から**読み取りのたびに導く**
（`src/shared/glossary-mastery.ts`）。

|                                    | 導出                                        | 列に保存                           |
| ---------------------------------- | ------------------------------------------- | ---------------------------------- |
| 同じ用語の 2 枚を続けて答える      | 何も起きない                                | 読んで書くので取りこぼす余地がある |
| オフラインで溜めた判定が後から届く | 次の取得で正しくなる                        | 列だけ古いまま残り、修復が要る     |
| 判定を書く経路                     | `POST /api/quizzes/:id/result` は**無改造** | あそこに書き戻しが増える           |

規則は「カードが 0 枚 or 未解答なら未習得 / **全部**マスターならマスター / それ以外は復習中」。
「全部」にしているのは、穴埋めだけ通って 4 択で落ちる状態を習得と呼ばないため。

### 検索はクライアント側で畳む

SQLite（D1）は ICU を持たないので、`LIKE` も `COLLATE NOCASE` も ASCII しか畳めない。
`ＴＣＰ` で `TCP` が引けず、`ﾈｯﾄﾜｰｸ`／`ネットワーク`／`ねっとわーく` が別物になる。
FTS5 なら畳めるが、仮想テーブルは Drizzle のスキーマに書けない。

そこでサーバーは**カテゴリとタグで粗く絞るだけ**にして、用語名・意味・タグの検索と
習得ステータスの絞り込みは `src/shared/glossary-search.ts` で行う。
正規化は NFKC →小文字化→カタカナをひらがなへ、の順（NFKC が先でないと半角カナが残る）。

副産物として **`%` `_` `\` のエスケープ漏れというバグが原理的に存在しない**（テストで固定）。
代わりに上限（500 件）で切れたら `truncated` を返し、画面で知らせる。
黙って切ると、手元の検索がコーパスの先頭しか見ていない状態になる。

### 出題は資格試験型の 4 択

学習記録・ノート・用語辞書の**どれから作っても 4 択**になる。
選択肢の形は AI が素材に合わせて 2 通りを使い分け、各問に `choiceStyle` を宣言させる。

| `choiceStyle` | 問い方                                         | 選択肢 | 足りないとき                   |
| ------------- | ---------------------------------------------- | ------ | ------------------------------ |
| `term`        | 説明文を読ませて**用語を選ばせる**             | 用語名 | 同じ生成の他の答え・用語で補う |
| `statement`   | 「〜に関する記述のうち、適切なものはどれか。」 | 記述文 | **補わずにその問題を捨てる**   |

- **記述型は誤答を補充しない**（`src/shared/choices.ts` の `buildChoices`）。
  記述 3 つに用語名を 1 個混ぜると、その 1 個だけ形が違って**読まなくても答えが分かる**
- 解説は**誤答がなぜ違うのか**に必ず 1 文触れさせる。資格試験の対策では解説が本体
- カテゴリの `examName` があればプロンプトに 1 行載せ、その試験の範囲・粒度・言い回しに寄せる。
  学習記録の生成は保存と同時に自動で走るので、生成のたびに入力させる形では効かない
- **4 択の正解番号は持たない。** `answer` と文字列一致で見る
- 選択肢は**必ず混ぜる**。モデルは正解を先頭に置きがちで、
  そのままだと「1 番を選べば当たる」カードが量産される。乱数は引数にしてテストで固定した
- 辞書からの生成では各問に `sourceTerm` を書かせ、**入力の用語名と完全一致しなければ捨てる**。
  無いと N 問を用語に対応付ける手段が順番しかなく、モデルは平気で 1 問落とす
- 4 択でも**選んだ瞬間には判定を送らない**（キーと click の二重発火、`correctCount` の意味が
  形式ごとに変わる、当たったが分かっていない場合の逃げ道）
- 音読モードは選択肢まで読む（「1、TCP。2、UDP…」）。読まないと耳だけでは何も選べない

一問一答（`qa`）と穴埋め（`cloze`）は**もう作られない**が、`QuestionType` の 3 値は残してある。
4 択に統一する前のカードがその値を持っていて、表示・回答・Anki 書き出しはこれまで通り動く。
穴埋めの空欄は `question` の中の `____` で表す（位置を別の列に持つと、問題文を手で直したときに
ずれて、ずれたことに気付けない）。

### AI 補完

用語名だけで意味とタグが埋まる。**既存タグの一覧をプロンプトの最後に置く**のが要点で、
指示は末尾ほど守られるうえ、ここが効かないと同じ分野が
「通信 / 通信技術 / ネットワーク」に割れて絞り込みが役に立たなくなる。
候補は用語と問題の**両方**のタグから集める（分けると使い始めた直後に候補が空になる）。

補完は**保存しない**。欄に入れるだけなので打ち直せる。失敗しても 200 で返して入力を巻き戻さない。

### まとめて登録

「用語を追加」の隣の ∨ →「まとめて追加」。**貼り付け → 表で直す → まとめて登録**の 2 段。

1 行の読み方（`src/client/lib/glossary-bulk-parse.ts`）:

- **タブがあれば最優先**（表計算からの貼り付けは曖昧さがない）
- 無ければ `:` `：` `,` `，` のうち**最も早く現れたもの**で、**最初の 1 個でだけ**割る。
  `OSI: 7層: 物理層から` の意味は `7層: 物理層から` になる
- `:` の直後が `/` なら区切りにしない（URL）。**空白と `、` では割らない**
  （`3ウェイ ハンドシェイク` と `パケットは、分割して送る` を壊さない）
- 箇条書きの記号を剥がす。ASCII の `- * +` と `1.` は空白が続くときだけ、`・` は空白の有無を問わない
- 読めなかった行は**黙って捨てず、行番号と理由を出す**（`rows + skipped = 空行を除いた行数`）

**判定は画面とサーバーが同じ関数を通る**（`src/shared/glossary-bulk.ts` の `prepareBulkTerms`）。
画面では押す前に「このカテゴリに登録済みです」が見え、問題のある行は**外すだけでボタンは止めない**。

サーバー側で気を付けたこと:

- 重複は **カテゴリ全件の `termKey` を 1 クエリで引く**。`inArray(termKey, 100件)` は
  バインド変数が 102 個になり D1 の上限 100 を越える
- INSERT は `glossary_terms` の 10 列から 1 文 10 行（**余白ゼロ**）。
  `onConflictDoNothing().returning({ id })` で、一意インデックスに当たった行を
  **例外ではなく数えられる結果**にする（事前チェックだけだと 10 行のチャンクごと落ちる）
- **常に部分成功＋報告**。D1 に対話的トランザクションが無いうえ、40 行中 3 行の重複で残り 37 を捨てるほうが損

空の意味は 🪄 で AI にまとめて埋めさせられる。**1 押し = Gemini 1 回 = 最大 20 件**
（応答が途中で切れるとその回は全滅するので件数で切る）。返ってきた値は**まだ空の行にだけ**入れ、
待っている間に打った内容は上書きしない。プロンプトには「意味の分からない語はでっち上げずに省く」
「同じ分野には同じタグ」の 2 行を足している。

### ノートからの登録

本文で語を選んで 📖 を押すと、裏で補完が走る小窓が開き、1 クリックで辞書に入る。

- **ノート本文は 1 文字も変えない。** `setDraftContent` も `schedule` も呼ばない
  （呼ぶと書いてもいないのに自動保存が走る）
- ボタンの `onMouseDown` の `preventDefault` は**マーカーと同じ理由で必須**。
  止めないと textarea からフォーカスが外れ、`selectionStart/End` が潰れる
- 改行を含む選択（＝文や段落）と長すぎる選択は弾き、`==` `**` `` ` `` などの記号は剥がす
- 登録済みの語はプレビューで点線の下線が付く（`src/client/lib/remark-glossary.ts`）。
  背景を付けないのは `==マーカー==` と見分けが付かなくなるため

## ノートの左右分割

タブはあったが、切り替えると前のノートは見えなくなる。2 枚を左右に並べられるようにした。

- 分割の規則は `src/client/lib/note-tabs.ts` の純粋関数に置いてテストする。
  **`activeId` は state として持たず、アクティブなペインから導出する**（真実の源を 2 つ作らない）
- **同じノートを両ペインに出さない。** 出すと片方の保存で `notebooks` が差し替わり、
  非保存側が「他端末で更新された」と誤検知する。反対側にあるノートを選んだときは
  フォーカスを移すだけ、ペイン指定なら左右を入れ替える
- **マウントするのは最大 2 枚。** effect と将来のリッチテキストのインスタンスが枚数に比例する
- 分割の可否は**ウィンドウ幅ではなく `main` の実測幅**で決める（`useElementWidth`）。
  サイドバーが 260px を占めるので、768px のウィンドウでも本文は 500px しかない
- 区切りはドラッグと矢印キーで動かせる（20〜80%）。比率は localStorage に残す
- 分割していないときのクラスは 1 文字も変えていない

## Google 連携

連携設定（サイドバー下部）から ON にする。**権限が無いまま ON を保存させない**
（保存できると「ON なのに毎回失敗する」状態が作れてしまう）。

| 機能                             | スコープ          | 向き                                                         |
| -------------------------------- | ----------------- | ------------------------------------------------------------ |
| タスク                           | `tasks`           | 双方向（Google Tasks の `@default` リスト）                  |
| カレンダー                       | `calendar.events` | 書き込み（タイマー確定時の記録と、タスク画面の月カレンダー） |
| バックアップ / ノート / 用語辞書 | `drive.file`      | 一方通行（アプリが作ったファイルだけ見える）                 |

### バックアップと復元

- `StudyRecall バックアップ` フォルダに `studyrecall-backup-YYYY-MM-DD-HHMM.json` を置く（最新 10 件）
- **`accounts` / `users` / `sessions` / `verifications` は絶対に入れない。**
  あのテーブルにはトークンとパスワードが入っている。混入していないことはテストで固定している
- 復元は「**落として検証 → 安全用バックアップを取る（取れなければ中止）→ 置き換える**」の順。
  D1 に対話的トランザクションが無く atomic にできないので、戻れる場所を先に作る
- ファイルの版は **3**（v2 → v3 でカテゴリに `examName` が増えた）。v1・v2 のファイルも読め、
  足りない項目は既定値で埋める（`READABLE_VERSIONS`）
- ノートは `カテゴリ名/親ノート/子ノート.md` の形でミラーできる。1 回で叩く Drive の回数に
  上限（30）があるので、多いときは `remaining` を返して次の実行に続ける

### 用語辞書の書き出し

`用語辞書` フォルダに `glossary.json` と `glossary.md` を置く。
JSON は正確に戻すため、Markdown は Drive 上で読むため。

**ファイル id を覚えて上書きする。** 毎回 upload すると Drive は同一フォルダ内の同名を許すので、
同じファイルが積み上がっていく。404/410 なら id を捨てて作り直す。

### 「自動同期」がサーバー側でできない理由

このリポジトリは `ctx.waitUntil` をどこでも使っておらず、cron トリガーも持っていない。

- **`waitUntil` は応答を先に返せるだけで、まとめてはくれない。** 10 回編集すれば 10 回叩く。
  失敗を出す場所も無い
- **cron は全ユーザーを 1 回の起動で回すことになる。** 誰か 1 人の 403 で後ろが詰まり、
  ユーザー単位の再試行状態も持てない。機能ではなく新しいサブシステム

代わりに**クライアントで 30 秒待ち、サーバーは 5 分の床を持つ**。
タブを閉じて飛んだぶんは、毎回 D1 から丸ごと作り直すので**遅れるだけで壊れない**。

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

## ノートの自動保存

書いたものが消えないよう、二段構えにしている。

| 層                    | いつ                              | 通信 |
| --------------------- | --------------------------------- | ---- |
| localStorage への退避 | **入力のたび**（debounce しない） | なし |
| サーバー保存          | 入力が止まって 2 秒後             | あり |

`studyrecall:note-draft:<id>` に退避が**残っている＝まだサーバーに載っていない**、という意味にしている。
保存が通った時点で消す。次にそのノートを開いたとき、退避が残っていれば復元する。

### 自動保存は競合ダイアログを開かない

入力中にモーダルが割り込むと書いている手が止まる。自動保存が 409 を受けたら
**バナー（他の端末で更新されています）に留め、そこで自動保存を止める**。
解決は明示的な「保存」ボタンから競合ダイアログで行う。

### 復元は 3 通りに分かれる（`decideRecovery`）

| 状況                                | 挙動                                     |
| ----------------------------------- | ---------------------------------------- |
| 退避が無い / 中身がサーバー版と同じ | 何もしない                               |
| 退避時点のサーバー版と現在が一致    | そのまま復元（差分は自分の未送信分だけ） |
| 退避後にサーバー側も動いていた      | 復元するが**競合として扱う**             |

3 番目では `baseUpdatedAt` に**退避した時点のトークン**を入れる。
ここに現在の `updatedAt` を入れると保存が素通りし、**他端末の更新を無言で踏み潰す**。
判定は `src/client/lib/note-draft.ts` に切り出してテストしてある。

## 間隔反復（SRS）

問題ごとに次回の出題日を持たせ、復習画面は既定で**期限が来たものだけ**を出す。
実装は `src/shared/srs.ts`（SM-2 の簡易版）。純粋関数なのでテストで固めてある。

正解を続けたときの伸び方は **1 → 6 → 15 → 38 日**。
間違えると間隔と連続正解回数がリセットされ、難易度係数だけが下がったまま残る
（一度つまずいたカードは以降の伸びが緩やかになる）。

### 判断したこと

- **難易度係数は 100 倍した整数で持つ**（250 = 2.50）。SQLite の REAL だと丸めが環境で変わり、
  同じ操作から違う間隔が出る余地が残る。日数計算は整数で閉じたほうが再現する
- **答えは 2 択なので SM-2 の quality を 2 値に写す**。「わかった」= 4、「まだ不安」= 2。
  quality=4 は係数を変えず、quality=2 は 0.32 下げる、という本来の式がそのまま効く
- **間違えたカードは翌日送りにせず、その場で出題対象のまま残す**（間隔 0）。
  「まだ不安」と答えた直後に消えてしまうと、覚え直す機会が無い
- **`isMastered`（習得率）とは別の軸**。習得率は累計正答が閾値を超えたかというざっくりした進捗、
  SRS は出題日の管理。両方を残しているので、習得率 0% でも出題予定は入る

### スキーマ

`quiz_questions` に `due_at` / `interval_days` / `ease_factor` / `repetitions` を追加した
（`0008_black_the_stranger.sql`。**すべて `ADD COLUMN` でテーブル再作成なし**）。
`due_at` が NULL は未学習で、常に出題対象になる。既存の問題はこれで自動的にキューへ入る。

## フローティング・ミニタイマー

タイマーの状態は `src/client/contexts/TimerProvider.tsx` がアプリ全体で 1 つだけ持つ。
以前は `StudyTab` が `useTimer()` を呼んでいたため、画面を移るとアンマウントされて
経過時間の表示も操作もできなくなっていた（計測自体はサーバーが持つので続いてはいた）。

Provider には**タイマーに付随する副作用も移してある** — ポモドーロのアラーム、集中サウンド、
記録モーダル、生成された問題。ノートを書きながらポモドーロを回すのが目的なので、
画面から離れた瞬間に音が止まるのでは意味がない。

- **`startedAt` ではなく `elapsedMs` を配る。** `useTimer` はサーバーの `elapsedMs` を
  アンカーにローカル差分を足す方式で、端末の時計ズレに強い。`startedAt` からの引き算に
  変えると、この耐性を捨てることになる
- **表示するのはモードで、カテゴリではない。** カテゴリは計測中には決まっておらず、
  記録するときに選ぶ設計のため（DB は変更していない）
- **タイマー画面では出さない**（同じ情報が大きく出ているので重複になる）
- **`z-40`。** モーダル（`z-50`）に覆われてほしい。`z-50` にすると暗幕の上にピルだけが
  浮いて、操作できそうに見えてしまう
- 計測中は `document.title` も `(24:15) 計測中 | StudyRecall` になる

どの画面から記録しても、終わるとタイマー画面へ移動して生成された問題をそこで見せる。

## ダークモード

`src/client/contexts/ThemeProvider.tsx`。`light` / `dark` / `system` の 3 択で、
`studyrecall:theme` に保存する。`<html>` の `dark` クラスを付け外しする。

> **Tailwind v4 では `@custom-variant dark` の宣言が要る。**
> v4 の `dark:` は既定で `prefers-color-scheme` を見るので、この 1 行が無いと
> `ThemeProvider` がクラスを付けても**何も変わらない**（設定は保存されるのに見た目だけ変わらない、
> という原因の分かりにくい状態になる）。

```css
@custom-variant dark (&:where(.dark, .dark *));
```

- **`index.html` にインラインスクリプトを置いて、React より先にクラスを当てる。**
  無いとダーク設定でも一瞬白い画面が出る（FOUC）
- **`ThemeProvider` は `AuthGate` より外**。ログイン画面もテーマに従わせるため
- `color-scheme` も切り替える。select の矢印やチェックボックスなどネイティブ部品のため

### トークンがテーマを吸収する

**`dark:` はコンポーネントに 1 つも書かない。** 面・線・文字・状態色はすべて
セマンティックなトークンを通し、`.dark` で**変数の値だけ**差し替える。

Tailwind v4 のユーティリティは値を埋め込まず `var(--color-*)` を参照するので、
これだけで追従する。

```css
.bg-surface {
  background-color: var(--color-surface);
}
```

```html
<!-- dark: を書かなくてもテーマで色が変わる -->
<body class="bg-canvas text-fg"></body>
```

> ⚠️ **`@theme inline` にしてはいけない。**
> `inline` を付けると値が展開されて `var()` 参照が消え、`.dark` の上書きが効かなくなる。
> 素の `@theme static` を使う（`static` は「まだ使われていない変数」が削られるのを防ぐ）。

反転が必要なものは、**反転をトークン側に閉じ込める**。

- **ヒートマップの草** — ライトは「薄い → 濃い青」、ダークは「暗い → 明るい青」で向きが逆。
  `--color-heat-0..4` を `.dark` で入れ替えるので、`Heatmap.tsx` に `dark:` は無い
- **コードブロック** — ライトでも暗いのが意図なので `--color-code` を別に切った
- **Toast** — 面ごと反転する塗り潰しなので `--color-solid` / `--color-solid-fg`

### 置換で踏んだ落とし穴

**不透明度が付いたクラスは対応表から漏れる。** `bg-white/90` は
`bg-white` と別のクラスなので変換されず、対になる `dark:bg-slate-950/90` だけが
消えて、**ダークでヘッダーが白いまま**になった。4 箇所あった。
同種を探すときは `(bg|text|border)-[a-z]+-?[0-9]*/[0-9]+` で洗う。

## バージョン表示

サイドバーのロゴの右に `v1.0` を出す。実体は **package.json の `version` だけ**で、
`vite.config.ts` の `define` でビルド時に埋め込む（`__APP_VERSION__`）。
2 か所に持つと必ずズレるため、正はここ 1 つに絞っている。

上げるとき:

```bash
npm run release
```

`minor` が 1 つ上がる（1.0.0 → 1.1.0、表示は `v1.1`）。

- 表示は **major.minor だけ**（`formatVersion`）。patch まで出すとロゴの隣で桁が邪魔になる。
  完全な番号はバッジの `title` に出るのでホバーで読める
- **ビルドのたびに自動で上げることはしない。** 開発中のビルドでも番号が進んでしまい、
  「表示されている番号」と「公開されている中身」の対応が取れなくなる
- `vitest.config.ts` にも同じ `define` を置いている。無いと `version.ts` の
  import 時点で `__APP_VERSION__` が未定義になり、テストが落ちる
- **dev サーバーは再起動しないと反映されない。** `define` は設定の読み込み時に確定する。
  本番は毎回まっさらにビルドされるので関係ない

## デザイントークンと UI プリミティブ

新しい UI を足すときは、まずここから使う。生のクラスを直書きしない。

### トークン（`src/client/index.css`）

| 種類       | トークン                                                                     | 使いどころ                                      |
| ---------- | ---------------------------------------------------------------------------- | ----------------------------------------------- |
| 面         | `canvas` / `surface` / `surface-2` / `surface-3`                             | 地 / カード / サイドバー / セグメントの溝       |
| 線         | `line` / `line-strong`                                                       | カードの縁 / 入力欄・浮遊要素                   |
| 文字       | `fg` / `fg-muted` / `fg-subtle`                                              | 本文 / 補助 / さらに弱い                        |
| 行         | `row-hover` / `row-selected`                                                 | ホバー（無彩色）/ 選択（青み）                  |
| アクセント | `accent` / `accent-hover` / `accent-soft` / `accent-text` / `accent-fg`      | `accent-fg` は塗り潰しの上に載る文字            |
| 状態       | `success` / `warning` / `danger` と `-soft` / `-line`                        | バナー・判定ボタン                              |
| 形         | `rounded-control`(8px) / `rounded-card`(12px)                                | 2 段だけ。`rounded-full` はドット・アバター専用 |
| 文字サイズ | `text-title`(20) / `text-section`(16) / `text-body`(14) / `text-caption`(12) | 4 段だけ                                        |
| 影         | `shadow-overlay`                                                             | **重なるものだけ。**カードは境界線で段を作る    |

> **`cn.ts` の `extendTailwindMerge` を外さないこと。**
> 設定が無いと tailwind-merge が `text-title`（サイズ）と `text-fg-muted`（色）を
> 同じ群と見なし、**後に書いたほうが前を黙って消す**。
> 「見出しだけ本文サイズに戻っている」という追いにくいバグになる。`cn.test.ts` が釘。

### プリミティブ（`src/client/ui/`）

`Button` / `IconButton` / `Card` / `CardSection` / `Field` / `Input` / `Select` /
`Textarea` / `Modal` / `Popover` / `Segmented` / `Banner` / `EmptyState` /
`selectableRow` / `LAYER`。

- すべて `cn(base, variants, className)` の順。**呼び出し側の `className` が最後**なので上書きできる
- ボタンの高さは `py-*` ではなく `h-*` で決める。行に並べたときに揃うのが保証される
- `disabled` は **opacity に一本化**。グレーで塗る方式は `danger`/`success` で意味が消える
- **`Modal` は `role="dialog"` を必ず出す。** `lib/keyboard.ts` がこれを見て
  「何か開いていれば復習のキーを無視する」と判定している。消すと裏のカードが誤爆する
- `SpeechPlayer` はモーダルではないので `role="dialog"` を**付けない**
  （`ReviewTab` が `keyboard={!isSpeechOpen}` で明示的に切っている）

### 選択とホバーを分ける（`selectableRow`）

| 状態   | 表現                                                          |
| ------ | ------------------------------------------------------------- |
| 選択   | `row-selected`（青み）+ 左 2px のアクセントバー + `fg` の文字 |
| ホバー | `row-hover`（無彩色）の面だけ。**バーは出さない**             |

作り直す前はどちらも「薄い面」で、**開発中に選択中の項目を読み違えるほど**区別が付かなかった。
バーは `::before` の絶対配置にしてある。`border-l` だと行幅が 2px 動き、
ツリーのインデント（インライン `style` で padding を計算している）とずれる。

### フォント

Inter を自己ホストする（`@fontsource-variable/inter`）。外部ドメインへ取りに行かないので
PWA でオフラインでも効く。

> **登録されるファミリ名は `'Inter Variable'`。** `'Inter'` では一致しない。
> 以前は `--font-sans` の先頭が `'Inter'` なのに `@font-face` も `<link>` も無く、
> **一度も読み込まれていなかった**（canvas で測ると素の `sans-serif` と幅が 1px も違わなかった）。

日本語の Web フォントは載せない。`@fontsource/noto-sans-jp` は 1 ウェイトで
124 ファイル・2.79MB あり、`workbox.globPatterns` が `woff2` を含むため
プリキャッシュに全部載って初回インストールが重くなる。日本語は各 OS の UI フォントで足りる。

Inter も latin 以外の 6 サブセット（170KB）は使わないので `globIgnores` で
プリキャッシュから外している（通常配信はされる）。

## ゴミ箱・復元

ノートの削除は**論理削除**（`notebooks.deletedAt`）。完全削除はゴミ箱からだけ。

副産物として、**生成済みの問題とのリンクが保たれたまま復元できる**。
物理削除では FK の `onDelete: 'set null'` が発火して `notebook_id` が外れていたが、
UPDATE では発火しない。以前より良くなっている。

- **全クエリに `alive()` を掛ける。** 1 箇所でも漏らすと、消したノートが移動先の候補や
  ツリーの深さ計算に紛れ込み、「見えないノートのせいで移動できない」という追いにくい不具合になる
- ゴミ箱は**「削除の起点」だけ**を並べる。子まで出すと同じものが何件も見えて数え間違える
- **復元で迷子を作らない。** 親がまだゴミ箱に残っているなら、カテゴリ直下へ引き上げる。
  そうしないと「復元したのにツリーのどこにも出てこない」状態になる
- 削除のトーストに「元に戻す」を付けてある。ゴミ箱を開きに行かせない

## 復習のキーボード操作

| キー              | 動作       |
| ----------------- | ---------- |
| `Space` / `Enter` | 答えを見る |
| `1` / `←`         | まだ不安   |
| `2` / `→`         | わかった   |

拾ってよいかの判定は `src/client/lib/keyboard.ts` に集約してテストしてある。
**迷ったら「無視する」側に倒す。** 効かないのは不便なだけだが、効いてほしくない場面で
効くと意図しない判定が記録される。文字入力中・モーダル表示中・修飾キー付きは拾わない。
答えを伏せたままでは判定できない（当てずっぽうを記録しない）。

キー操作は**復習画面のカードだけ**。タイマー画面とノート画面はカードを縦に並べるので、
全部が同じキーを取り合うと破綻する。ハンズフリー再生中も切る
（あちらは下部バーで独自のキューを持つため、裏で判定が飛ぶと聞いている内容と記録がずれる）。

## Gemini の月次上限

1 ユーザーあたり **300 問/月**（`MONTHLY_GENERATION_LIMIT`）。JST の月で数える。
誰でもサインインできる状態で公開しているので、第三者の生成が API キーの持ち主に課金される。

**専用のカラムは持たない。** `quiz_questions.created_at` を数えれば足りる。
カウンタを別に持つと、生成の失敗や巻き戻しのたびにズレていく。

上限に当たったときの扱いは入り口ごとに違う。

| 入り口                       | 挙動                                       |
| ---------------------------- | ------------------------------------------ |
| 学習記録                     | **記録は保存し** warning を返す            |
| ノートからの生成             | ノートは保存済みなので warning のみ        |
| 辞書からの生成               | 保存するものが無いので warning のみ        |
| 用語の AI 補完（1 件・一括） | 生成が本体で保存するものが無いので **429** |

「生成の失敗が保存を巻き込まない」という既存の方針をそのまま当てている。

> **既知の歪み**: `quota.ts` は用語の**行数**も月次の数に入れている。一括登録で AI を使わずに
> 100 件貼り付けても 100 消費する。1 回の貼り付けを 100 行までにして歪みを抑えているが、
> 用語を数えるのをやめるかどうかは未決。

## エクスポート

出口は 2 か所ある。**サイドバー下部は全件**、**復習画面のボタンは表示中の絞り込みだけ**。
片方に寄せると「全部欲しい」「この条件だけ欲しい」のどちらかが必ず不便になるので、両方残している。

- **Anki 用 CSV** — 表面 / 裏面（解答 `<br><br>` 解説）/ タグ の3列。
  Anki はフィールドを HTML として読むので改行タグがそのまま効く。BOM は付けない（1列目が壊れるため）。
  復習画面の「この条件をAnki出力」は**現在の絞り込み結果**で、件数をボタンに出している
- **Markdown ZIP** — ツリーをそのままフォルダにした `カテゴリ名/親/子.md` の構造。
  YAML フロントマター（`title` / `category` / `parent` / `created` / `updated`）付き

## テスト

`npm test`（Vitest）。**全部は書かず、壊れると被害が大きい純粋関数だけ**を対象にしている。

- `src/shared/note-tree.test.ts` — **サーバーとクライアントが同じ実装を共有している**ので、
  ここが壊れると「UI とサーバーがズレる」のではなく**両方が同時に間違う**。循環・深さ上限・
  部分木の高さの境界を固めてある
- `src/client/lib/export.test.ts` — Anki CSV と Markdown フロントマター。
  書き出しは外部ツールが読むもので、壊れても画面上は何も起きない
- `src/client/lib/pomodoro.test.ts` — `focusMs` は**記録される学習時間そのもの**
- `src/shared/srs.test.ts` — 出題間隔。**間違っていても数週間後にしか症状が出ない**
- `src/client/lib/note-draft.test.ts` — 下書き復元の判定。誤れば他端末の更新を巻き戻す
- `src/client/lib/cn.test.ts` — 自前トークンの競合解決。設定が外れると
  **見出しのサイズが黙って消える**（`text-title` と `text-fg-muted` が同じ群と誤認される）

DOM やネットワークを触るものは対象外（`environment: 'node'`）。
設定を `vite.config.ts` と分けているのは、テストのたびに Worker のビルドと SW 生成を
走らせる必要がないため。

> テストに実効性があるかは、`canMove` の深さ判定にオフバイワンを入れて 2 件落ちることで確認した。

### vitest のバージョンは 4 系に固定している

`better-auth` が `peerOptional vitest@"^2 || ^3 || ^4"` を宣言しているため、
5 系を入れると **`npm ci` が ERESOLVE で落ちる**（Workers Builds のビルドが壊れる）。
`npm install` は通ってしまうので気付きにくい。バージョンを変えたら `npm ci --dry-run` で確かめる。

## バンドル

初回ロードに要らないものは動的 import に逃がしてある。

| チャンク           | サイズ               | 読み込まれる契機               |
| ------------------ | -------------------- | ------------------------------ |
| `index`            | 382 KB (gzip 118 KB) | 起動時                         |
| `MarkdownRenderer` | 156 KB (gzip 46 KB)  | ノートをプレビュー表示したとき |
| `jszip`            | 96 KB (gzip 28 KB)   | ZIP を書き出すとき             |
| `confetti`         | 11 KB (gzip 4 KB)    | 紙吹雪を出すとき               |

分割前は単一チャンク 609 KB（gzip 189 KB）で、Vite の 500KB 警告が出続けていた。
SW のプリキャッシュは 20 件 731 KiB（うち Inter latin が 48 KB）。
起動直後に見えるのはタイマー画面なので、Markdown も ZIP も紙吹雪もその時点では要らない。

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
- **用語の習得ステータスは列に持たず、カードから導く**。持つと書き戻しの競合と、
  オフラインで溜めた判定の取りこぼしが同時に付いてくる（→ 用語辞書の節）。
- **日本語の検索は D1 に投げない**。ICU が無いので大小・全半角・カナを畳めない。
  正規化と絞り込みは `src/shared/glossary-search.ts` で行い、サーバーは粗く絞るだけにする。
- **バックアップの版を上げるときは `READABLE_VERSIONS` に古い版を残す**。
  `parseSnapshot` が完全一致で弾く作りだったので、素直に上げると
  **既存ユーザーのドライブにあるバックアップが全部読めなくなる**。
- **remark プラグインは「アタッチャ」を返す**。unified は配列の関数をアタッチャとして呼び、
  その戻り値を変換関数として使う。変換関数を直接返すと `tree` が undefined のまま走って落ちる
  （プレビューが真っ白になった）。内部の変換関数を直に叩くテストだけでは通り抜ける。
- **4 択の記述型は誤答を補充しない**。用語名を 1 個混ぜた 4 択は読まなくても解ける。
  4 個そろわなければ問題ごと捨てる（`buildChoices`）。
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
- **D1 は 1 クエリのバインド変数を 100 個までに制限している。**
  `D1_ERROR: too many SQL variables at offset 672: SQLITE_ERROR` が出る。
  複数行 INSERT は列数から 1 文あたりの行数を決めて分割する
  （`src/worker/lib/quiz-insert.ts` の `maxRowsPerInsert` / `chunkRows`）。
  **列数はテーブル定義から数える**ので、あとで列が増えても黙って上限を越えない
  （`quiz_questions` は 18 → 21 列になり、1 文 5 行 → 4 行に自動で下がった）。
  `glossary_terms` は 10 列でちょうど 10 行（余白ゼロ）。**`inArray` の引数もバインド変数**なので、
  100 件の存在確認を `IN (...)` で投げると 102 個になって越える。
- 再作成の `INSERT ... SELECT` は、旧テーブルにまだ無い新規カラムまで SELECT してくるため、リテラルに書き換える。

## スコープ外

リアルタイム同期（WebSocket・SSE でのプッシュ）/ ノートのバージョン履歴・3-way マージ
（競合時は「破棄 or 強制上書き」の二択）/ オフライン時のノート編集キュー（判定のみ対象）/
ドライブからの**読み戻し**（書き出しは一方通行）/ 用語の CSV・ファイル取り込み（貼り付けだけ）/
サーバー側の本物のレート制限（AI 補完は行を作らないので月次の数に乗らない）/
用語同士のリンク
