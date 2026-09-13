import { eq } from 'drizzle-orm';
import { userSettings } from '../../db/schema';
import { DEFAULT_POMODORO, type PomodoroConfig } from '../../shared/pomodoro-config';
import type { Db } from './db';

/**
 * ユーザーごとの連携設定。
 *
 * **行が無いことを「既定のまま」として扱う。** サインイン時に作る作りにすると、
 * 既存ユーザーのぶんを埋める処理が別に要る。読むときに既定値を返し、
 * 書くときに初めて行を作れば、その手当てが要らない。
 */

export interface Settings {
  calendarSyncEnabled: boolean;
  calendarId: string;
  tasksSyncedAt: Date | null;
  /** 1 日 1 回、自動で Google ドライブへバックアップするか */
  driveBackupEnabled: boolean;
  /** アプリが作ったバックアップ用フォルダ。移動・改名されても id は変わらない */
  driveFolderId: string | null;
  driveBackupAt: Date | null;
  /** ノートを .md としてもミラーするか */
  driveNotesEnabled: boolean;
  /** 用語辞書を Drive に書き出すか */
  driveGlossaryEnabled: boolean;
  /** 書き出した glossary.json の id。**覚えないと同名ファイルが積み上がる** */
  glossaryJsonFileId: string | null;
  glossaryMdFileId: string | null;
  glossarySyncedAt: Date | null;
  /** 次に開始するポモドーロの周期（分）。**全端末で共有する** → shared/pomodoro-config.ts */
  pomodoroWorkMinutes: number;
  pomodoroBreakMinutes: number;
  pomodoroLongBreakMinutes: number;
  /** 0 = 長い休憩なし */
  pomodoroLongBreakEvery: number;
}

const DEFAULTS: Settings = {
  // 人の主カレンダーへは、明示的に ON にされるまで書かない
  calendarSyncEnabled: false,
  calendarId: 'primary',
  tasksSyncedAt: null,
  // 人の Drive にも、明示的に ON にされるまで書かない
  driveBackupEnabled: false,
  driveFolderId: null,
  driveBackupAt: null,
  driveNotesEnabled: false,
  driveGlossaryEnabled: false,
  glossaryJsonFileId: null,
  glossaryMdFileId: null,
  glossarySyncedAt: null,
  // 以前の固定値と同じ。設定していない人のタイマーの動きを変えない
  ...pomodoroColumns(DEFAULT_POMODORO),
};

export async function getSettings(db: Db, userId: string): Promise<Settings> {
  const [row] = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  if (!row) return { ...DEFAULTS };
  return {
    calendarSyncEnabled: row.calendarSyncEnabled,
    calendarId: row.calendarId,
    tasksSyncedAt: row.tasksSyncedAt,
    driveBackupEnabled: row.driveBackupEnabled,
    driveFolderId: row.driveFolderId,
    driveBackupAt: row.driveBackupAt,
    driveNotesEnabled: row.driveNotesEnabled,
    driveGlossaryEnabled: row.driveGlossaryEnabled,
    glossaryJsonFileId: row.glossaryJsonFileId,
    glossaryMdFileId: row.glossaryMdFileId,
    glossarySyncedAt: row.glossarySyncedAt,
    pomodoroWorkMinutes: row.pomodoroWorkMinutes,
    pomodoroBreakMinutes: row.pomodoroBreakMinutes,
    pomodoroLongBreakMinutes: row.pomodoroLongBreakMinutes,
    pomodoroLongBreakEvery: row.pomodoroLongBreakEvery,
  };
}

/** 設定の行からポモドーロの周期を取り出す */
export function pomodoroOf(settings: Settings): PomodoroConfig {
  return {
    workMinutes: settings.pomodoroWorkMinutes,
    breakMinutes: settings.pomodoroBreakMinutes,
    longBreakMinutes: settings.pomodoroLongBreakMinutes,
    longBreakEvery: settings.pomodoroLongBreakEvery,
  };
}

/**
 * 周期を列の形に戻す。`user_settings` と `timer_sessions` は**同じ列名**で持っているので、
 * 設定の保存にも、開始したセッションへの写しにも同じ形で使える。
 */
export function pomodoroColumns(config: PomodoroConfig) {
  return {
    pomodoroWorkMinutes: config.workMinutes,
    pomodoroBreakMinutes: config.breakMinutes,
    pomodoroLongBreakMinutes: config.longBreakMinutes,
    pomodoroLongBreakEvery: config.longBreakEvery,
  };
}

/** 指定した項目だけ更新する。行が無ければ既定値の上に載せて作る。 */
export async function saveSettings(
  db: Db,
  userId: string,
  patch: Partial<Settings>,
): Promise<Settings> {
  const current = await getSettings(db, userId);
  const next: Settings = { ...current, ...patch };
  const now = new Date();

  await db
    .insert(userSettings)
    .values({ userId, ...next, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: { ...next, updatedAt: now },
    });

  return next;
}
