import {
  index,
  integer,
  sqliteTable,
  text,
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
    mode: text('mode', { enum: ['free', 'pomodoro'] }).notNull().default('free'),
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
 * 一問一答フラッシュカード。
 * 生成元は3系統ある: 学習記録(studyLogId) / ノート(notebookId) / 手動追加(どちらも null)。
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
    question: text('question').notNull(),
    answer: text('answer').notNull(),
    explanation: text('explanation'),
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
    // 「今日の復習」= dueAt が来ているものの絞り込み
    index('quiz_questions_user_due_idx').on(t.userId, t.dueAt),
  ],
);

export type User = typeof users.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type StudyLog = typeof studyLogs.$inferSelect;
export type Notebook = typeof notebooks.$inferSelect;
export type TimerSession = typeof timerSessions.$inferSelect;
export type QuizQuestion = typeof quizQuestions.$inferSelect;
