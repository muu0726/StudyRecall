import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

/**
 * StudyRecall のスキーマ定義。
 * ここが唯一の真実で、migrations/ の SQL は drizzle-kit generate で生成する。
 *
 * 日時は integer(mode: 'timestamp') = UNIX 秒。Drizzle が Date と相互変換する。
 */

// ---------------------------------------------------------------------------
// Better Auth 用テーブル
// モデル名 user / session / account / verification を複数形のテーブルに割り当てる。
// カラム構成は Better Auth のコアスキーマに合わせること（欠けると認証が動かない）。
// ---------------------------------------------------------------------------

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  // DB レベルでは nullable のまま。notNull にすると SQLite ではテーブル再作成が必要になり、
  // DROP TABLE users が categories などへ ON DELETE cascade を伝播させてデータを消してしまう。
  // Better Auth は常に name を書き込むため、実運用上は常に値が入る。
  name: text('name'),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    token: text('token').notNull().unique(),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const accounts = sqliteTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    // Better Auth 1.7 の account モデルで必須。ローカル認証は `local:<providerId>`、
    // OAuth は `local:oauth:<providerId>` という名前空間を使う。
    issuer: text('issuer').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp' }),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp' }),
    scope: text('scope'),
    password: text('password'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('accounts_user_idx').on(t.userId)],
);

export const verifications = sqliteTable(
  'verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
);

// ---------------------------------------------------------------------------
// アプリ本体のテーブル
// ---------------------------------------------------------------------------

/** 学習科目・項目（例: ネットワーク / 基本情報 / 英語） */
export const categories = sqliteTable(
  'categories',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull().default('#3b82f6'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('categories_user_idx').on(t.userId)],
);

/** 学習記録。notes がフラッシュカード生成の入力になる。 */
export const studyLogs = sqliteTable(
  'study_logs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    durationMinutes: integer('duration_minutes').notNull(),
    notes: text('notes'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    // 履歴一覧と「今日／今週」の集計を支える
    index('study_logs_user_created_idx').on(t.userId, t.createdAt),
  ],
);

/** クラウドノート。Markdown 本文を文字列で保存する。 */
export const notebooks = sqliteTable(
  'notebooks',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    /**
     * 親ノート。null ならカテゴリ直下のルート。
     * 自己参照なので戻り値の型注釈が要る（付けないと循環参照で型エラーになる）。
     *
     * 不変条件: 子は必ず親と同じ categoryId を持つ（カテゴリが最上位という前提）。
     */
    parentId: text('parent_id').references((): AnySQLiteColumn => notebooks.id, {
      onDelete: 'cascade',
    }),
    /** 兄弟間の並び順。小さいほど上。 */
    sortOrder: integer('sort_order').notNull().default(0),
    /**
     * ゴミ箱。null なら生きている。
     *
     * 物理削除にすると、親を消したときに子孫ごと取り返しがつかなくなる。
     * 論理削除なら FK の `onDelete: 'set null'` が発火しないので、
     * **生成済みの問題との紐付けが保たれたまま復元できる**（物理削除より良くなる）。
     */
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
    title: text('title').notNull(),
    content: text('content').notNull(),
    /*
     * Google ドライブへ .md としてミラーした跡。**一方通行**なので、
     * ここは「最後にこちらから書いたときの状態」しか持たない。
     */
    /** Drive 上のファイル id。null なら未書き出し */
    driveFileId: text('drive_file_id'),
    /**
     * 最後に書いた場所（'カテゴリ/親/子.md'）。
     * **親を改名しても子の updatedAt は変わらない**ので、これが無いと
     * 改名後の子が古いフォルダに取り残される。
     */
    drivePath: text('drive_path'),
    driveSyncedAt: integer('drive_synced_at', { mode: 'timestamp_ms' }),
    // ミリ秒精度。updatedAt は楽観的ロックのトークンに使うため、秒精度だと
    // 「最後の更新と同じ秒内に2端末が保存する」ケースで競合を取りこぼす。
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    // 一覧は更新順で引く
    index('notebooks_user_updated_idx').on(t.userId, t.updatedAt),
    // ツリーの子取得と並び替えを支える
    index('notebooks_user_parent_order_idx').on(t.userId, t.parentId, t.sortOrder),
    // 生きているノートの絞り込みとゴミ箱の一覧
    index('notebooks_user_deleted_idx').on(t.userId, t.deletedAt),
  ],
);

/**
 * 稼働中の学習タイマー。複数端末で同じセッションを共有する（ミラーリング）。
 *
 * 経過時間 = accumulatedMs + (isRunning ? now - startedAt : 0)
 * アクティブなセッション = completedAt IS NULL の最新行。
 */
export const timerSessions = sqliteTable(
  'timer_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 現在の計測区間の開始時刻 */
    startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
    /** 一時停止までに積み上げた分 */
    accumulatedMs: integer('accumulated_ms').notNull().default(0),
    isRunning: integer('is_running', { mode: 'boolean' }).notNull().default(true),
    /**
     * 'free' = フリー計測 / 'pomodoro' = 25分集中 + 5分休憩。
     * 集中/休憩のフェーズは elapsedMs から決定的に導出できるので、
     * この 1 列を共有するだけで全端末の表示が一致する。
     */
    mode: text('mode', { enum: ['free', 'pomodoro'] })
      .notNull()
      .default('free'),
    /** null なら稼働中。確定済みなら確定時刻が入る */
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
    /** 確定時に作られた学習記録 */
    studyLogId: text('study_log_id').references(() => studyLogs.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  // アクティブなセッションを引くため
  (t) => [index('timer_sessions_user_completed_idx').on(t.userId, t.completedAt)],
);

/**
 * 用語辞書。**カード（quiz_questions）とは別の資産**として持つ。
 *
 * それまでの「用語を追加」は用語と説明を Gemini に渡して問題を 1 問作り、
 * **元の用語と説明を捨てていた**。作り直したくなっても材料が残っていない。
 * ここに残しておけば、同じ用語から一問一答・穴埋め・4択を何度でも作り直せる。
 *
 * **習得ステータスはこの行に持たない。** カード側の状態から読み取り時に導く
 * （→ src/shared/glossary-mastery.ts）。持つと、オフラインで溜めた判定が
 * 後から届いたときにここだけ古いまま取り残される。
 */
export const glossaryTerms = sqliteTable(
  'glossary_terms',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /**
     * カテゴリは他のユーザー所有テーブルと同じく必須。
     * ここから作るカードが categoryId を必須にしているので、null だと生成時に決められない。
     */
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    /** ノートの選択範囲から登録したときの出所。ノートを消しても用語は残す。 */
    notebookId: text('notebook_id').references(() => notebooks.id, { onDelete: 'set null' }),
    term: text('term').notNull(),
    /**
     * 検索と重複判定のための正規化キー。NFKC + 小文字化 + カタカナ→ひらがな。
     * **SQLite は ICU を持たない**ので、アプリ側で作って保存する。
     * 作る場所は src/shared/glossary-search.ts の normalizeForSearch() ひとつだけ。
     */
    termKey: text('term_key').notNull(),
    /** 意味。AI 補完の前は空でもよいので notNull + default('')。 */
    definition: text('definition').notNull().default(''),
    /** quiz_questions.tags と同じ形。json_each() で展開・集計できる。 */
    tags: text('tags', { mode: 'json' }).$type<string[]>().notNull().default([]),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    // 一覧は更新順で引く
    index('glossary_terms_user_updated_idx').on(t.userId, t.updatedAt),
    index('glossary_terms_user_category_idx').on(t.userId, t.categoryId),
    index('glossary_terms_notebook_idx').on(t.notebookId),
    /*
     * 同じカテゴリに同じ用語を二重登録させない。
     * 全体で一意にしないのは、「ネットワーク」の tunnel と「英語」の tunnel が
     * 別物として成立するため。
     */
    uniqueIndex('glossary_terms_user_category_key_unq').on(t.userId, t.categoryId, t.termKey),
  ],
);

/**
 * 一問一答フラッシュカード。
 * 生成元は4系統ある: 学習記録(studyLogId) / ノート(notebookId) / 用語辞書(glossaryTermId) / 手動追加。
 */
export const quizQuestions = sqliteTable(
  'quiz_questions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    studyLogId: text('study_log_id').references(() => studyLogs.id, { onDelete: 'cascade' }),
    // ノートを消しても蓄積した問題は残す（復習資産を巻き込んで消さない）
    notebookId: text('notebook_id').references(() => notebooks.id, { onDelete: 'set null' }),
    /** 用語辞書から作った問題の出所。用語を消してもカードは残す（notebookId と同じ扱い）。 */
    glossaryTermId: text('glossary_term_id').references(() => glossaryTerms.id, {
      onDelete: 'set null',
    }),
    question: text('question').notNull(),
    answer: text('answer').notNull(),
    explanation: text('explanation'),
    /**
     * 出題形式。'qa' = 一問一答 / 'cloze' = 穴埋め / 'quiz' = 4択。
     * **既存の行はすべて 'qa'** として扱われ、見た目も動きも変わらない。
     */
    questionType: text('question_type', { enum: ['qa', 'cloze', 'quiz'] })
      .notNull()
      .default('qa'),
    /**
     * 4択のときだけ 4 要素。それ以外は空配列。
     * **正解の番号は持たない。** answer と文字列一致で照合する。
     * 番号を持つと、選択肢を並べ替えるたびに整合を取る場所が増える。
     */
    choices: text('choices', { mode: 'json' }).$type<string[]>().notNull().default([]),
    /** ジャンルタグ。実体は JSON 文字列なので json_each() で展開・集計できる。 */
    tags: text('tags', { mode: 'json' }).$type<string[]>().notNull().default([]),
    isMastered: integer('is_mastered', { mode: 'boolean' }).notNull().default(false),
    correctCount: integer('correct_count').notNull().default(0),
    incorrectCount: integer('incorrect_count').notNull().default(0),
    lastAnsweredAt: integer('last_answered_at', { mode: 'timestamp' }),

    // --- 間隔反復（SRS）。詳細は src/shared/srs.ts ---
    /** 次に出題してよくなる時刻。null は未学習で、常に出題対象。 */
    dueAt: integer('due_at', { mode: 'timestamp' }),
    /** 現在の間隔（日）。0 は「まだ間隔がついていない」。 */
    intervalDays: integer('interval_days').notNull().default(0),
    /**
     * 難易度係数を 100 倍した整数（250 = 2.50）。
     * REAL で持つと丸めが環境で変わり、同じ操作から違う間隔が出る余地が残る。
     */
    easeFactor: integer('ease_factor').notNull().default(250),
    /** 連続正解回数。間違えると 0 に戻る。 */
    repetitions: integer('repetitions').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index('quiz_questions_user_category_idx').on(t.userId, t.categoryId),
    // 「未習得のみ」フィルタ用
    index('quiz_questions_user_mastered_idx').on(t.userId, t.isMastered),
    // ヒートマップの日別集計（lastAnsweredAt の範囲スキャン）を支える
    index('quiz_questions_user_answered_idx').on(t.userId, t.lastAnsweredAt),
    index('quiz_questions_study_log_idx').on(t.studyLogId),
    index('quiz_questions_notebook_idx').on(t.notebookId),
    // 用語ごとの習得ステータスを導くための集計を支える
    index('quiz_questions_glossary_idx').on(t.glossaryTermId),
    // 「今日の復習」= dueAt が来ているものの絞り込み
    index('quiz_questions_user_due_idx').on(t.userId, t.dueAt),
  ],
);

/**
 * タスク（ToDo）。Google Tasks の `@default` リストと双方向に同期する。
 *
 * **物理削除しない。** 未連携や通信断のときにローカルで消すと、行ごと消してしまうと
 * 「Google 側も消す」という事実まで失われ、次の同期で消したはずのタスクが復活する。
 * deletedAt を立てて墓標として残し、リモート削除が通ってから行を消す。
 */
export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Google Tasks 側の一意 ID。null なら「まだ Google に無い」 */
    googleTaskId: text('google_task_id'),
    // カテゴリ・ノートは任意の紐付け。消えてもタスクは残す。
    categoryId: text('category_id').references(() => categories.id, { onDelete: 'set null' }),
    notebookId: text('notebook_id').references(() => notebooks.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    memo: text('memo'),
    /**
     * 期日。**'YYYY-MM-DD' の文字列**（JST の日付）。
     * Google Tasks の due は実質「日付」で時刻が意味を持たないため、
     * タイムスタンプに落とすとタイムゾーンで前日にずれる。
     */
    dueDate: text('due_date'),
    isCompleted: integer('is_completed', { mode: 'boolean' }).notNull().default(false),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
    sortOrder: integer('sort_order').notNull().default(0),
    /** 墓標。null なら生きている。 */
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
    /** 最後に取り込んだ Google 側の updated。突き合わせの基準になる。 */
    googleUpdatedAt: integer('google_updated_at', { mode: 'timestamp_ms' }),
    /**
     * 'pending' = ローカルの変更がまだ Google に届いていない。
     * これが無いと、送信に失敗した追加が永久にローカルだけに留まる。
     */
    syncState: text('sync_state', { enum: ['pending', 'synced'] })
      .notNull()
      .default('pending'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    // 一覧（生きているものだけ）と期日順の表示
    index('tasks_user_deleted_idx').on(t.userId, t.deletedAt),
    index('tasks_user_due_idx').on(t.userId, t.dueDate),
    // 同期で Google の ID から引く
    index('tasks_user_google_idx').on(t.userId, t.googleTaskId),
  ],
);

/**
 * ユーザーごとの連携設定。ユーザー 1 人につき 1 行。
 *
 * 行が無いことを「既定のまま」として扱う。サインイン時に作らないのは、
 * 既存ユーザーのぶんを埋める処理が要らないようにするため。
 */
export const userSettings = sqliteTable('user_settings', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** タイマー確定時にカレンダーへ書くか。**既定は false**（人の主カレンダーは勝手に触らない） */
  calendarSyncEnabled: integer('calendar_sync_enabled', { mode: 'boolean' })
    .notNull()
    .default(false),
  calendarId: text('calendar_id').notNull().default('primary'),
  /** 最後に Google Tasks を取り込んだ時刻。次回の updatedMin に使う。 */
  tasksSyncedAt: integer('tasks_synced_at', { mode: 'timestamp_ms' }),
  /** 1 日 1 回、自動で Google ドライブへバックアップするか。**既定は false** */
  driveBackupEnabled: integer('drive_backup_enabled', { mode: 'boolean' }).notNull().default(false),
  /** アプリが作ったバックアップ用フォルダの id。移動・改名されても変わらない */
  driveFolderId: text('drive_folder_id'),
  /** 最後にバックアップした時刻。24 時間の判定に使う。 */
  driveBackupAt: integer('drive_backup_at', { mode: 'timestamp_ms' }),
  /** ノートを .md としてもミラーするか。**既定は false** */
  driveNotesEnabled: integer('drive_notes_enabled', { mode: 'boolean' }).notNull().default(false),
  /** 用語辞書を Drive に書き出すか。**既定は false**（人の Drive に勝手に書かない） */
  driveGlossaryEnabled: integer('drive_glossary_enabled', { mode: 'boolean' })
    .notNull()
    .default(false),
  /*
   * 書き出したファイルの id。**覚えておかないと同名ファイルが積み上がる**
   * （Drive は同じフォルダ内の同名を許すので、毎回 upload すると増える一方になる）。
   */
  glossaryJsonFileId: text('glossary_json_file_id'),
  glossaryMdFileId: text('glossary_md_file_id'),
  glossarySyncedAt: integer('glossary_synced_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export type User = typeof users.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type StudyLog = typeof studyLogs.$inferSelect;
export type Notebook = typeof notebooks.$inferSelect;
export type TimerSession = typeof timerSessions.$inferSelect;
export type QuizQuestion = typeof quizQuestions.$inferSelect;
export type GlossaryTerm = typeof glossaryTerms.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type UserSettings = typeof userSettings.$inferSelect;
