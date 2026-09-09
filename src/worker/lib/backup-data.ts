import { eq, getTableColumns } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import {
  categories,
  notebooks,
  quizQuestions,
  studyLogs,
  tasks,
  timerSessions,
} from '../../db/schema';
import { countRows, type BackupData, type SnapshotRows } from '../../shared/backup';
import type { Db } from './db';
import { chunkRows, maxRowsPerInsert } from './quiz-insert';
import { getSettings, saveSettings } from './user-settings';

/**
 * バックアップに載せる行を D1 から集める。
 *
 * **ルートハンドラを通さない。** `GET /api/quizzes` は `QUIZ_LIMIT = 200`、
 * `/api/study-logs` は `LOG_LIMIT = 100` で切っている（画面用の上限としては妥当）。
 * バックアップがそこを通ると**黙って欠けたファイル**ができる。テーブルを直接引く。
 *
 * ゴミ箱のノートも、削除済みタスクの墓標（`deletedAt`）も**含める**。
 * 「消した」という事実も状態のうちで、落とすと復元後にゴミ箱が空になる。
 */

/** 全テーブル合計の行数の上限。超えたら切り詰めずに断る */
export const MAX_ROWS = 50_000;
/** JSON にしたあとの上限。Worker のメモリと Drive への送信を現実的な範囲に収める */
export const MAX_BYTES = 8 * 1024 * 1024;

export async function collectSnapshotRows(db: Db, userId: string): Promise<SnapshotRows> {
  const [categoryRows, notebookRows, logRows, timerRows, quizRows, taskRows, settings] =
    await Promise.all([
      db.select().from(categories).where(eq(categories.userId, userId)),
      db.select().from(notebooks).where(eq(notebooks.userId, userId)),
      db.select().from(studyLogs).where(eq(studyLogs.userId, userId)),
      db.select().from(timerSessions).where(eq(timerSessions.userId, userId)),
      db.select().from(quizQuestions).where(eq(quizQuestions.userId, userId)),
      db.select().from(tasks).where(eq(tasks.userId, userId)),
      getSettings(db, userId),
    ]);

  return {
    categories: categoryRows,
    notebooks: notebookRows,
    studyLogs: logRows,
    timerSessions: timerRows,
    quizQuestions: quizRows,
    tasks: taskRows,
    settings: {
      calendarSyncEnabled: settings.calendarSyncEnabled,
      calendarId: settings.calendarId,
    },
  };
}

// ---------------------------------------------------------------------------
// 復元
// ---------------------------------------------------------------------------

/**
 * 1 文あたりの行数を列数から決めて流し込む。
 *
 * **D1 はバインド変数を 1 クエリ 100 個までに制限している。** 既存の
 * `maxRowsPerInsert` / `chunkRows`（quiz-insert.ts）をそのまま使う。列数は
 * テーブル定義から数えるので、あとで列が増えても黙って上限を越えない。
 */
async function insertAll<T>(
  table: SQLiteTable,
  rows: T[],
  insert: (chunk: T[]) => Promise<unknown>,
): Promise<void> {
  const size = maxRowsPerInsert(Object.keys(getTableColumns(table)).length);
  for (const chunk of chunkRows(rows, size)) {
    await insert(chunk);
  }
}

/**
 * スナップショットの中身で置き換える。
 *
 * **D1 に対話的トランザクションが無いので、これは atomic にできない。**
 * 途中で落ちれば半分消えた状態が残る。だから呼び出し側（routes/backup.ts）は
 * **この関数を呼ぶ前に必ず安全用のバックアップを取り、取れなければ復元しない**。
 * 原理的に atomic にできない以上、戻れる場所を先に作るのが唯一の手当て。
 *
 * `user_settings` の行は消さない。消すと **Drive のフォルダ id を失って
 * 復元元のフォルダを見失う**。カレンダーの 2 項目だけスナップショットから戻す。
 */
export async function applySnapshot(
  db: Db,
  userId: string,
  data: BackupData,
): Promise<Record<string, number>> {
  /*
   * 消す順は子 → 親。FK の cascade に任せず自分で消すのは、D1 で外部キー制約が
   * 効いているかに挙動を依存させないため（categories.ts の purge と同じ理由）。
   */
  await db.delete(quizQuestions).where(eq(quizQuestions.userId, userId));
  await db.delete(timerSessions).where(eq(timerSessions.userId, userId));
  await db.delete(tasks).where(eq(tasks.userId, userId));
  await db.delete(studyLogs).where(eq(studyLogs.userId, userId));
  await db.delete(notebooks).where(eq(notebooks.userId, userId));
  await db.delete(categories).where(eq(categories.userId, userId));

  const date = (value: string) => new Date(value);
  const dateOrNull = (value: string | null) => (value === null ? null : new Date(value));

  // 入れる順は親 → 子。とくに notebooks は自己参照なので、親が先に入っていないと
  // FK で落ちる（親→子の並びは parseSnapshot が保証している）。
  await insertAll(
    categories,
    data.categories.map((row) => ({
      id: row.id,
      userId,
      name: row.name,
      color: row.color,
      createdAt: date(row.createdAt),
    })),
    (chunk) => db.insert(categories).values(chunk),
  );

  await insertAll(
    studyLogs,
    data.studyLogs.map((row) => ({
      id: row.id,
      userId,
      categoryId: row.categoryId,
      durationMinutes: row.durationMinutes,
      notes: row.notes,
      createdAt: date(row.createdAt),
    })),
    (chunk) => db.insert(studyLogs).values(chunk),
  );

  await insertAll(
    notebooks,
    data.notebooks.map((row) => ({
      id: row.id,
      userId,
      categoryId: row.categoryId,
      parentId: row.parentId,
      sortOrder: row.sortOrder,
      deletedAt: dateOrNull(row.deletedAt),
      title: row.title,
      content: row.content,
      createdAt: date(row.createdAt),
      updatedAt: date(row.updatedAt),
    })),
    (chunk) => db.insert(notebooks).values(chunk),
  );

  await insertAll(
    timerSessions,
    data.timerSessions.map((row) => ({
      id: row.id,
      userId,
      startedAt: date(row.startedAt),
      accumulatedMs: row.accumulatedMs,
      isRunning: row.isRunning,
      mode: row.mode,
      completedAt: dateOrNull(row.completedAt),
      studyLogId: row.studyLogId,
      createdAt: date(row.createdAt),
      updatedAt: date(row.updatedAt),
    })),
    (chunk) => db.insert(timerSessions).values(chunk),
  );

  await insertAll(
    quizQuestions,
    data.quizQuestions.map((row) => ({
      id: row.id,
      userId,
      categoryId: row.categoryId,
      studyLogId: row.studyLogId,
      notebookId: row.notebookId,
      question: row.question,
      answer: row.answer,
      explanation: row.explanation,
      tags: row.tags,
      isMastered: row.isMastered,
      correctCount: row.correctCount,
      incorrectCount: row.incorrectCount,
      lastAnsweredAt: dateOrNull(row.lastAnsweredAt),
      dueAt: dateOrNull(row.dueAt),
      intervalDays: row.intervalDays,
      easeFactor: row.easeFactor,
      repetitions: row.repetitions,
      createdAt: date(row.createdAt),
    })),
    (chunk) => db.insert(quizQuestions).values(chunk),
  );

  await insertAll(
    tasks,
    data.tasks.map((row) => ({
      id: row.id,
      userId,
      googleTaskId: row.googleTaskId,
      categoryId: row.categoryId,
      notebookId: row.notebookId,
      title: row.title,
      memo: row.memo,
      dueDate: row.dueDate,
      isCompleted: row.isCompleted,
      completedAt: dateOrNull(row.completedAt),
      sortOrder: row.sortOrder,
      deletedAt: dateOrNull(row.deletedAt),
      googleUpdatedAt: dateOrNull(row.googleUpdatedAt),
      syncState: row.syncState,
      createdAt: date(row.createdAt),
      updatedAt: date(row.updatedAt),
    })),
    (chunk) => db.insert(tasks).values(chunk),
  );

  if (data.settings) {
    // **Drive の 3 列は触らない。** 消すと復元元のフォルダを見失う。
    await saveSettings(db, userId, {
      calendarSyncEnabled: data.settings.calendarSyncEnabled,
      calendarId: data.settings.calendarId,
    });
  }

  return countRows(data);
}
