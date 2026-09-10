import { eq } from 'drizzle-orm';
import { userSettings } from '../../db/schema';
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
