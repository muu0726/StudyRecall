/**
 * バックアップのファイル形式。**純粋関数だけ。**
 *
 * ここが「Drive に置く JSON」の唯一の定義で、組み立ても検証も並べ替えもここにある。
 * vitest が `environment: 'node'` で DOM を持たず描画側をテストできないのと同じ理由で、
 * 判断が要るところを全部この層に寄せてある。ルートは呼ぶだけにする。
 *
 * ─────────────────────────────────────────────────────────────
 * **入れてはいけないもの: `accounts`。**
 *
 * あのテーブルには `access_token` `refresh_token` `id_token` `password` が入っている。
 * 人の Google ドライブに置くファイルへ混ぜたら、それは事故ではなく**漏洩**。
 * `users` / `sessions` / `verifications` も同じ理由で入れない
 * （バックアップに要るのは「その人が作ったもの」であって、認証の状態ではない）。
 * 混入していないことは backup.test.ts で固定している。
 * ─────────────────────────────────────────────────────────────
 */

/** いま書き出す版 */
export const BACKUP_VERSION = 3;

/**
 * まだ読める版。
 *
 * **上げるときにここを足し忘れると、既存のバックアップが全部読めなくなる。**
 * 復元できないバックアップにはバックアップの意味が無いので、
 * 版を上げても古いものは読み続ける（足りない項目は既定値で埋める）。
 * v1 との差: glossaryTerms が無く、問題に questionType / choices / glossaryTermId が無い。
 * v2 との差: カテゴリに examName が無い。
 */
const READABLE_VERSIONS: readonly number[] = [1, 2, 3];
export const BACKUP_APP = 'study-recall';

/** 全テーブル合計の行数の上限。これを超えるものは扱わない */
export const MAX_BACKUP_ROWS = 50_000;

// ---------------------------------------------------------------------------
// ファイルに載せる形
//
// **時刻はすべて ISO 文字列。** D1 の秒／ミリ秒の使い分けは保存側の都合で、
// Drizzle が Date で出し入れするのでファイル形式には出さない。
// notebooks.updatedAt は楽観ロックのトークンでミリ秒精度が要るが、ISO はそれを持つ。
// tasks.dueDate は元から 'YYYY-MM-DD' の文字列なのでそのまま。
//
// **userId は載せない。** 復元するのは「そのファイルを持っている人」なので、
// 書き戻すときに現在のユーザー ID を当てる。他人の id が漏れることも無くなる。
// ---------------------------------------------------------------------------

export interface BackupCategory {
  id: string;
  name: string;
  color: string;
  /** 対象の資格試験名。v2 までのファイルには無いので、読むときは null で埋める */
  examName: string | null;
  createdAt: string;
}

export interface BackupStudyLog {
  id: string;
  categoryId: string;
  durationMinutes: number;
  notes: string | null;
  createdAt: string;
}

export interface BackupNotebook {
  id: string;
  categoryId: string;
  parentId: string | null;
  sortOrder: number;
  deletedAt: string | null;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface BackupTimerSession {
  id: string;
  startedAt: string;
  accumulatedMs: number;
  isRunning: boolean;
  mode: 'free' | 'pomodoro';
  completedAt: string | null;
  studyLogId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BackupGlossaryTerm {
  id: string;
  categoryId: string;
  notebookId: string | null;
  term: string;
  definition: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface BackupQuiz {
  id: string;
  categoryId: string;
  studyLogId: string | null;
  notebookId: string | null;
  /** 用語辞書から作った問題の出所 */
  glossaryTermId: string | null;
  question: string;
  answer: string;
  explanation: string | null;
  questionType: 'qa' | 'cloze' | 'quiz';
  /** 4択のときだけ 4 要素 */
  choices: string[];
  tags: string[];
  isMastered: boolean;
  correctCount: number;
  incorrectCount: number;
  lastAnsweredAt: string | null;
  dueAt: string | null;
  intervalDays: number;
  easeFactor: number;
  repetitions: number;
  createdAt: string;
}

export interface BackupTask {
  id: string;
  googleTaskId: string | null;
  categoryId: string | null;
  notebookId: string | null;
  title: string;
  memo: string | null;
  dueDate: string | null;
  isCompleted: boolean;
  completedAt: string | null;
  sortOrder: number;
  deletedAt: string | null;
  googleUpdatedAt: string | null;
  syncState: 'pending' | 'synced';
  createdAt: string;
  updatedAt: string;
}

export interface BackupSettings {
  calendarSyncEnabled: boolean;
  calendarId: string;
}

export interface BackupData {
  categories: BackupCategory[];
  /** 親が子より先に並ぶ。復元は自己参照の FK があるのでこの順序が要る */
  notebooks: BackupNotebook[];
  /** **termKey は載せない。** 用語名から作り直せるので、復元時に計算する */
  glossaryTerms: BackupGlossaryTerm[];
  studyLogs: BackupStudyLog[];
  timerSessions: BackupTimerSession[];
  quizQuestions: BackupQuiz[];
  tasks: BackupTask[];
  settings: BackupSettings | null;
}

export interface BackupSnapshot {
  version: number;
  app: typeof BACKUP_APP;
  exportedAt: string;
  /** 目視用。**復元では信用せず数え直す** */
  counts: Record<string, number>;
  data: BackupData;
}

// ---------------------------------------------------------------------------
// 組み立て
// ---------------------------------------------------------------------------

const iso = (value: Date): string => value.toISOString();
const isoOrNull = (value: Date | null | undefined): string | null =>
  value ? value.toISOString() : null;

/**
 * D1 から読んだ行。Drizzle の `$inferSelect` がそのまま入る形にしてあるが、
 * **要る項目だけを構造的に書く**（userId を型に含めないので、渡しても載らない）。
 */
export interface SnapshotRows {
  categories: {
    id: string;
    name: string;
    color: string;
    examName: string | null;
    createdAt: Date;
  }[];
  notebooks: {
    id: string;
    categoryId: string;
    parentId: string | null;
    sortOrder: number;
    deletedAt: Date | null;
    title: string;
    content: string;
    createdAt: Date;
    updatedAt: Date;
  }[];
  glossaryTerms: {
    id: string;
    categoryId: string;
    notebookId: string | null;
    term: string;
    definition: string;
    tags: string[];
    createdAt: Date;
    updatedAt: Date;
  }[];
  studyLogs: {
    id: string;
    categoryId: string;
    durationMinutes: number;
    notes: string | null;
    createdAt: Date;
  }[];
  timerSessions: {
    id: string;
    startedAt: Date;
    accumulatedMs: number;
    isRunning: boolean;
    mode: 'free' | 'pomodoro';
    completedAt: Date | null;
    studyLogId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }[];
  quizQuestions: {
    id: string;
    categoryId: string;
    studyLogId: string | null;
    notebookId: string | null;
    glossaryTermId: string | null;
    question: string;
    answer: string;
    explanation: string | null;
    questionType: 'qa' | 'cloze' | 'quiz';
    choices: string[];
    tags: string[];
    isMastered: boolean;
    correctCount: number;
    incorrectCount: number;
    lastAnsweredAt: Date | null;
    dueAt: Date | null;
    intervalDays: number;
    easeFactor: number;
    repetitions: number;
    createdAt: Date;
  }[];
  tasks: {
    id: string;
    googleTaskId: string | null;
    categoryId: string | null;
    notebookId: string | null;
    title: string;
    memo: string | null;
    dueDate: string | null;
    isCompleted: boolean;
    completedAt: Date | null;
    sortOrder: number;
    deletedAt: Date | null;
    googleUpdatedAt: Date | null;
    syncState: 'pending' | 'synced';
    createdAt: Date;
    updatedAt: Date;
  }[];
  settings: BackupSettings | null;
}

export function buildSnapshot(rows: SnapshotRows, now: Date): BackupSnapshot {
  const data: BackupData = {
    categories: rows.categories.map((row) => ({
      id: row.id,
      name: row.name,
      color: row.color,
      examName: row.examName,
      createdAt: iso(row.createdAt),
    })),
    // 親が先に来る順で書き出す。壊れたファイルを渡された場合に備えて、
    // 復元側でも並べ替え直す（ここは「素直に読める」ための配慮）。
    notebooks: (sortNotebooksByDepth(rows.notebooks) ?? rows.notebooks).map((row) => ({
      id: row.id,
      categoryId: row.categoryId,
      parentId: row.parentId,
      sortOrder: row.sortOrder,
      deletedAt: isoOrNull(row.deletedAt),
      title: row.title,
      content: row.content,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    })),
    glossaryTerms: rows.glossaryTerms.map((row) => ({
      id: row.id,
      categoryId: row.categoryId,
      notebookId: row.notebookId,
      term: row.term,
      definition: row.definition,
      tags: Array.isArray(row.tags) ? row.tags : [],
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    })),
    studyLogs: rows.studyLogs.map((row) => ({
      id: row.id,
      categoryId: row.categoryId,
      durationMinutes: row.durationMinutes,
      notes: row.notes,
      createdAt: iso(row.createdAt),
    })),
    timerSessions: rows.timerSessions.map((row) => ({
      id: row.id,
      startedAt: iso(row.startedAt),
      accumulatedMs: row.accumulatedMs,
      isRunning: row.isRunning,
      mode: row.mode,
      completedAt: isoOrNull(row.completedAt),
      studyLogId: row.studyLogId,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    })),
    quizQuestions: rows.quizQuestions.map((row) => ({
      id: row.id,
      categoryId: row.categoryId,
      studyLogId: row.studyLogId,
      notebookId: row.notebookId,
      glossaryTermId: row.glossaryTermId,
      question: row.question,
      answer: row.answer,
      explanation: row.explanation,
      questionType: row.questionType,
      choices: Array.isArray(row.choices) ? row.choices : [],
      tags: Array.isArray(row.tags) ? row.tags : [],
      isMastered: row.isMastered,
      correctCount: row.correctCount,
      incorrectCount: row.incorrectCount,
      lastAnsweredAt: isoOrNull(row.lastAnsweredAt),
      dueAt: isoOrNull(row.dueAt),
      intervalDays: row.intervalDays,
      easeFactor: row.easeFactor,
      repetitions: row.repetitions,
      createdAt: iso(row.createdAt),
    })),
    tasks: rows.tasks.map((row) => ({
      id: row.id,
      googleTaskId: row.googleTaskId,
      categoryId: row.categoryId,
      notebookId: row.notebookId,
      title: row.title,
      memo: row.memo,
      dueDate: row.dueDate,
      isCompleted: row.isCompleted,
      completedAt: isoOrNull(row.completedAt),
      sortOrder: row.sortOrder,
      deletedAt: isoOrNull(row.deletedAt),
      googleUpdatedAt: isoOrNull(row.googleUpdatedAt),
      syncState: row.syncState,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    })),
    settings: rows.settings,
  };

  return {
    version: BACKUP_VERSION,
    app: BACKUP_APP,
    exportedAt: iso(now),
    counts: countRows(data),
    data,
  };
}

export function countRows(data: BackupData): Record<string, number> {
  return {
    categories: data.categories.length,
    notebooks: data.notebooks.length,
    glossaryTerms: data.glossaryTerms.length,
    studyLogs: data.studyLogs.length,
    timerSessions: data.timerSessions.length,
    quizQuestions: data.quizQuestions.length,
    tasks: data.tasks.length,
  };
}

export function totalRows(data: BackupData): number {
  return Object.values(countRows(data)).reduce((sum, n) => sum + n, 0);
}

/** ファイル名。Drive 上で新しい順に並べたときに読めるようにする（JST） */
export function backupFileName(now: Date): string {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString();
  return `studyrecall-backup-${jst.slice(0, 10)}-${jst.slice(11, 13)}${jst.slice(14, 16)}.json`;
}

// ---------------------------------------------------------------------------
// ノートの並べ替え（自己参照の FK があるので親を先に入れる必要がある）
// ---------------------------------------------------------------------------

/**
 * 親→子の順に並べ替える。**閉路か行方不明の親があれば null。**
 *
 * `notebooks.parentId` は自己参照なので、親が入っていない状態で子を入れると
 * FK で落ちる。並べ替えをルートに書くとテストできないのでここに置く。
 * null が返るのは「そのファイルは復元できない」という意味で、呼び出し側は断る。
 */
export function sortNotebooksByDepth<T extends { id: string; parentId: string | null }>(
  notebooks: readonly T[],
): T[] | null {
  const byParent = new Map<string | null, T[]>();
  for (const notebook of notebooks) {
    const siblings = byParent.get(notebook.parentId);
    if (siblings) siblings.push(notebook);
    else byParent.set(notebook.parentId, [notebook]);
  }

  const sorted: T[] = [];
  // ルート（親が null）から幅優先で降りる。閉路の中の行はここに一度も現れない。
  let frontier = byParent.get(null) ?? [];
  while (frontier.length > 0) {
    sorted.push(...frontier);
    frontier = frontier.flatMap((parent) => byParent.get(parent.id) ?? []);
  }

  // 全部拾えていなければ、行方不明の親か閉路がある
  return sorted.length === notebooks.length ? sorted : null;
}

// ---------------------------------------------------------------------------
// 検証
//
// ファイルは**ユーザーの Drive にあり、本人が編集できる**。中身を信用しない。
// ---------------------------------------------------------------------------

export type ParseResult = { ok: true; value: BackupSnapshot } | { ok: false; error: string };

const fail = (error: string): ParseResult => ({ ok: false, error });

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const str = (value: unknown): value is string => typeof value === 'string';
const num = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const bool = (value: unknown): value is boolean => typeof value === 'boolean';
const nullableStr = (value: unknown): value is string | null => value === null || str(value);
/** ISO 8601 として読める文字列か。Date に通して往復で確かめる */
const isoStr = (value: unknown): value is string => str(value) && !Number.isNaN(Date.parse(value));
const nullableIso = (value: unknown): value is string | null => value === null || isoStr(value);

function readArray(container: Record<string, unknown>, key: string): unknown[] | null {
  const value = container[key];
  return Array.isArray(value) ? value : null;
}

/**
 * 受け取った中身を検証して `BackupSnapshot` にする。
 *
 * 形だけでなく**参照整合性も見る**。壊れた参照を D1 に流すと FK エラーで
 * 途中まで消えた状態が残るので、書き込む前にここで落とす。
 */
export function parseSnapshot(raw: unknown): ParseResult {
  if (!isObject(raw)) return fail('バックアップファイルの形式が正しくありません。');
  if (raw.app !== BACKUP_APP) return fail('StudyRecall のバックアップファイルではありません。');
  if (!num(raw.version) || !READABLE_VERSIONS.includes(raw.version)) {
    return fail(
      `このバックアップは対応していない形式です（version ${String(raw.version)}／対応は ${READABLE_VERSIONS.join(', ')}）。`,
    );
  }
  if (!isoStr(raw.exportedAt)) return fail('バックアップの作成日時が読めません。');
  if (!isObject(raw.data)) return fail('バックアップの中身が読めません。');

  const source = raw.data;
  const categories: BackupCategory[] = [];
  const notebooks: BackupNotebook[] = [];
  const glossaryTerms: BackupGlossaryTerm[] = [];
  const studyLogs: BackupStudyLog[] = [];
  const timerSessions: BackupTimerSession[] = [];
  const quizQuestions: BackupQuiz[] = [];
  const tasks: BackupTask[] = [];

  const rawCategories = readArray(source, 'categories');
  const rawNotebooks = readArray(source, 'notebooks');
  // v1 のファイルには無い。無いことは壊れていることではない
  const rawGlossary = source.glossaryTerms === undefined ? [] : readArray(source, 'glossaryTerms');
  const rawStudyLogs = readArray(source, 'studyLogs');
  const rawTimerSessions = readArray(source, 'timerSessions');
  const rawQuizzes = readArray(source, 'quizQuestions');
  const rawTasks = readArray(source, 'tasks');
  if (
    !rawCategories ||
    !rawNotebooks ||
    !rawGlossary ||
    !rawStudyLogs ||
    !rawTimerSessions ||
    !rawQuizzes ||
    !rawTasks
  ) {
    return fail('バックアップの中身が読めません。');
  }

  const total =
    rawCategories.length +
    rawNotebooks.length +
    rawGlossary.length +
    rawStudyLogs.length +
    rawTimerSessions.length +
    rawQuizzes.length +
    rawTasks.length;
  if (total > MAX_BACKUP_ROWS) {
    return fail(`バックアップの件数が多すぎます（${total} 件／上限 ${MAX_BACKUP_ROWS} 件）。`);
  }

  for (const row of rawCategories) {
    if (
      !isObject(row) ||
      !str(row.id) ||
      !str(row.name) ||
      !str(row.color) ||
      !isoStr(row.createdAt)
    ) {
      return fail('カテゴリの形式が正しくありません。');
    }
    // v2 までのファイルには無い。**無いことは壊れていることではない**
    if (row.examName !== undefined && !nullableStr(row.examName)) {
      return fail('カテゴリの形式が正しくありません。');
    }
    categories.push({
      id: row.id,
      name: row.name,
      color: row.color,
      examName: row.examName === undefined ? null : row.examName,
      createdAt: row.createdAt,
    });
  }
  const categoryIds = new Set(categories.map((c) => c.id));

  for (const row of rawNotebooks) {
    if (
      !isObject(row) ||
      !str(row.id) ||
      !str(row.categoryId) ||
      !nullableStr(row.parentId) ||
      !num(row.sortOrder) ||
      !nullableIso(row.deletedAt) ||
      !str(row.title) ||
      !str(row.content) ||
      !isoStr(row.createdAt) ||
      !isoStr(row.updatedAt)
    ) {
      return fail('ノートの形式が正しくありません。');
    }
    if (!categoryIds.has(row.categoryId)) {
      return fail('ノートが、存在しないカテゴリを指しています。');
    }
    notebooks.push({
      id: row.id,
      categoryId: row.categoryId,
      parentId: row.parentId,
      sortOrder: row.sortOrder,
      deletedAt: row.deletedAt,
      title: row.title,
      content: row.content,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
  const notebookIds = new Set(notebooks.map((n) => n.id));
  for (const notebook of notebooks) {
    if (notebook.parentId !== null && !notebookIds.has(notebook.parentId)) {
      return fail('ノートの親が見つかりません。');
    }
  }
  const orderedNotebooks = sortNotebooksByDepth(notebooks);
  if (!orderedNotebooks) return fail('ノートの親子関係が循環しています。');

  for (const row of rawGlossary) {
    if (
      !isObject(row) ||
      !str(row.id) ||
      !str(row.categoryId) ||
      !nullableStr(row.notebookId) ||
      !str(row.term) ||
      !str(row.definition) ||
      !Array.isArray(row.tags) ||
      !row.tags.every(str) ||
      !isoStr(row.createdAt) ||
      !isoStr(row.updatedAt)
    ) {
      return fail('用語の形式が正しくありません。');
    }
    if (!categoryIds.has(row.categoryId)) {
      return fail('用語が、存在しないカテゴリを指しています。');
    }
    if (row.notebookId !== null && !notebookIds.has(row.notebookId)) {
      return fail('用語が、存在しないノートを指しています。');
    }
    glossaryTerms.push({
      id: row.id,
      categoryId: row.categoryId,
      notebookId: row.notebookId,
      term: row.term,
      definition: row.definition,
      tags: row.tags,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
  const glossaryIds = new Set(glossaryTerms.map((t) => t.id));

  for (const row of rawStudyLogs) {
    if (
      !isObject(row) ||
      !str(row.id) ||
      !str(row.categoryId) ||
      !num(row.durationMinutes) ||
      !nullableStr(row.notes) ||
      !isoStr(row.createdAt)
    ) {
      return fail('学習記録の形式が正しくありません。');
    }
    if (!categoryIds.has(row.categoryId)) {
      return fail('学習記録が、存在しないカテゴリを指しています。');
    }
    studyLogs.push({
      id: row.id,
      categoryId: row.categoryId,
      durationMinutes: row.durationMinutes,
      notes: row.notes,
      createdAt: row.createdAt,
    });
  }
  const studyLogIds = new Set(studyLogs.map((l) => l.id));

  for (const row of rawTimerSessions) {
    if (
      !isObject(row) ||
      !str(row.id) ||
      !isoStr(row.startedAt) ||
      !num(row.accumulatedMs) ||
      !bool(row.isRunning) ||
      (row.mode !== 'free' && row.mode !== 'pomodoro') ||
      !nullableIso(row.completedAt) ||
      !nullableStr(row.studyLogId) ||
      !isoStr(row.createdAt) ||
      !isoStr(row.updatedAt)
    ) {
      return fail('タイマーの記録の形式が正しくありません。');
    }
    if (row.studyLogId !== null && !studyLogIds.has(row.studyLogId)) {
      return fail('タイマーの記録が、存在しない学習記録を指しています。');
    }
    timerSessions.push({
      id: row.id,
      startedAt: row.startedAt,
      accumulatedMs: row.accumulatedMs,
      isRunning: row.isRunning,
      mode: row.mode,
      completedAt: row.completedAt,
      studyLogId: row.studyLogId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  for (const row of rawQuizzes) {
    if (
      !isObject(row) ||
      !str(row.id) ||
      !str(row.categoryId) ||
      !nullableStr(row.studyLogId) ||
      !nullableStr(row.notebookId) ||
      !str(row.question) ||
      !str(row.answer) ||
      !nullableStr(row.explanation) ||
      !Array.isArray(row.tags) ||
      !row.tags.every(str) ||
      !bool(row.isMastered) ||
      !num(row.correctCount) ||
      !num(row.incorrectCount) ||
      !nullableIso(row.lastAnsweredAt) ||
      !nullableIso(row.dueAt) ||
      !num(row.intervalDays) ||
      !num(row.easeFactor) ||
      !num(row.repetitions) ||
      !isoStr(row.createdAt)
    ) {
      return fail('問題の形式が正しくありません。');
    }
    if (!categoryIds.has(row.categoryId)) return fail('問題が、存在しないカテゴリを指しています。');
    if (row.studyLogId !== null && !studyLogIds.has(row.studyLogId)) {
      return fail('問題が、存在しない学習記録を指しています。');
    }
    if (row.notebookId !== null && !notebookIds.has(row.notebookId)) {
      return fail('問題が、存在しないノートを指しています。');
    }

    /*
     * ここから 3 項目は **v1 のファイルには無い**。
     * 無ければ既定値（従来と同じ一問一答）として読む。
     * 「無い」は許すが「あるのに形が違う」は断る。
     */
    const glossaryTermId = row.glossaryTermId === undefined ? null : row.glossaryTermId;
    if (!nullableStr(glossaryTermId)) return fail('問題の形式が正しくありません。');
    if (glossaryTermId !== null && !glossaryIds.has(glossaryTermId)) {
      return fail('問題が、存在しない用語を指しています。');
    }

    const questionType = row.questionType === undefined ? 'qa' : row.questionType;
    if (questionType !== 'qa' && questionType !== 'cloze' && questionType !== 'quiz') {
      return fail('問題の形式が正しくありません。');
    }

    const choices = row.choices === undefined ? [] : row.choices;
    if (!Array.isArray(choices) || !choices.every(str)) {
      return fail('問題の形式が正しくありません。');
    }

    quizQuestions.push({
      id: row.id,
      categoryId: row.categoryId,
      studyLogId: row.studyLogId,
      notebookId: row.notebookId,
      glossaryTermId,
      question: row.question,
      answer: row.answer,
      explanation: row.explanation,
      questionType,
      choices,
      tags: row.tags,
      isMastered: row.isMastered,
      correctCount: row.correctCount,
      incorrectCount: row.incorrectCount,
      lastAnsweredAt: row.lastAnsweredAt,
      dueAt: row.dueAt,
      intervalDays: row.intervalDays,
      easeFactor: row.easeFactor,
      repetitions: row.repetitions,
      createdAt: row.createdAt,
    });
  }

  for (const row of rawTasks) {
    if (
      !isObject(row) ||
      !str(row.id) ||
      !nullableStr(row.googleTaskId) ||
      !nullableStr(row.categoryId) ||
      !nullableStr(row.notebookId) ||
      !str(row.title) ||
      !nullableStr(row.memo) ||
      !nullableStr(row.dueDate) ||
      !bool(row.isCompleted) ||
      !nullableIso(row.completedAt) ||
      !num(row.sortOrder) ||
      !nullableIso(row.deletedAt) ||
      !nullableIso(row.googleUpdatedAt) ||
      (row.syncState !== 'pending' && row.syncState !== 'synced') ||
      !isoStr(row.createdAt) ||
      !isoStr(row.updatedAt)
    ) {
      return fail('タスクの形式が正しくありません。');
    }
    if (row.categoryId !== null && !categoryIds.has(row.categoryId)) {
      return fail('タスクが、存在しないカテゴリを指しています。');
    }
    if (row.notebookId !== null && !notebookIds.has(row.notebookId)) {
      return fail('タスクが、存在しないノートを指しています。');
    }
    tasks.push({
      id: row.id,
      googleTaskId: row.googleTaskId,
      categoryId: row.categoryId,
      notebookId: row.notebookId,
      title: row.title,
      memo: row.memo,
      dueDate: row.dueDate,
      isCompleted: row.isCompleted,
      completedAt: row.completedAt,
      sortOrder: row.sortOrder,
      deletedAt: row.deletedAt,
      googleUpdatedAt: row.googleUpdatedAt,
      syncState: row.syncState,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  let settings: BackupSettings | null = null;
  if (source.settings !== null && source.settings !== undefined) {
    const row = source.settings;
    if (!isObject(row) || !bool(row.calendarSyncEnabled) || !str(row.calendarId)) {
      return fail('設定の形式が正しくありません。');
    }
    settings = { calendarSyncEnabled: row.calendarSyncEnabled, calendarId: row.calendarId };
  }

  const data: BackupData = {
    categories,
    notebooks: orderedNotebooks,
    glossaryTerms,
    studyLogs,
    timerSessions,
    quizQuestions,
    tasks,
    settings,
  };

  return {
    ok: true,
    value: {
      // 読めた時点で中身は最新の形に揃っている（v1 は既定値で埋めた）
      version: BACKUP_VERSION,
      app: BACKUP_APP,
      exportedAt: raw.exportedAt,
      // counts は目視用。ファイルの値は信用せず数え直す。
      counts: countRows(data),
      data,
    },
  };
}
