import { asc, eq } from 'drizzle-orm';
import { categories, glossaryTerms, quizQuestions } from '../../db/schema';
import { buildGlossaryJson, buildGlossaryMarkdown } from '../../shared/glossary-export';
import { deriveMasteryStatus } from '../../shared/glossary-mastery';
import { deleteFile, ensureFolder, findFolder, updateText, uploadText } from './google-drive';
import { statusOf } from './google-error';
import { glossaryCardsJoin, glossarySelectWithStats } from './queries';
import { getSettings, saveSettings } from './user-settings';
import type { Db } from './db';

/**
 * 用語辞書を Google ドライブに書き出す。**一方通行。**
 *
 * `note-mirror.ts` と違って **subrequest の予算が要らない。**
 * あちらはノート 1 冊 = 1 ファイルで件数に比例して増えるが、こちらは
 * 何件あっても書くのは 2 ファイル。1 回で叩くのは
 * ensureFolder（1〜2）＋ 書き込み 2 の、多くて 4 回で頭打ちになる。
 *
 * ファイル id を `user_settings` に覚えて `updateText` で上書きする。
 * 毎回 `uploadText` すると **Drive は同一フォルダ内の同名を許す**ので、
 * glossary.json が何枚も積み上がっていく。
 */

/** 用語辞書用のサブフォルダ名。バックアップ用フォルダの下に作る */
export const GLOSSARY_FOLDER_NAME = '用語辞書';
export const GLOSSARY_JSON_NAME = 'glossary.json';
export const GLOSSARY_MD_NAME = 'glossary.md';

const JSON_MIME = 'application/json';
const MARKDOWN_MIME = 'text/markdown';

export interface GlossaryMirrorResult {
  /** 書き出した用語の件数 */
  terms: number;
  syncedAt: string;
  folderId: string;
}

/** D1 から、書き出しに要る形で読む。習得ステータスは一覧と同じ導出を通す。 */
async function readTerms(db: Db, userId: string) {
  const rows = await db
    .select(glossarySelectWithStats)
    .from(glossaryTerms)
    .innerJoin(categories, eq(glossaryTerms.categoryId, categories.id))
    .leftJoin(quizQuestions, glossaryCardsJoin(userId))
    .where(eq(glossaryTerms.userId, userId))
    .groupBy(glossaryTerms.id)
    .orderBy(asc(glossaryTerms.createdAt));

  return rows.map((row) => ({
    term: row.term,
    definition: row.definition,
    tags: Array.isArray(row.tags) ? row.tags : [],
    masteryStatus: deriveMasteryStatus({
      cardCount: Number(row.cardCount ?? 0),
      masteredCardCount: Number(row.masteredCardCount ?? 0),
      answeredCardCount: Number(row.answeredCardCount ?? 0),
    }),
    categoryName: row.categoryName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

/**
 * 覚えている id があれば上書きし、無ければ作る。
 *
 * **Drive 側で消されていることがある。** 404/410 を掴んだら id を捨てて作り直す
 * （note-mirror.ts と同じ手当て）。ここで諦めると、以後ずっと書けなくなる。
 */
async function writeOrCreate(
  accessToken: string,
  folderId: string,
  fileId: string | null,
  name: string,
  mimeType: string,
  body: string,
): Promise<string> {
  if (fileId) {
    try {
      await updateText(accessToken, fileId, mimeType, body);
      return fileId;
    } catch (error) {
      const status = statusOf(error);
      if (status !== 404 && status !== 410) throw error;
      console.warn(`[glossary-mirror] ${name} is gone; recreating`);
    }
  }
  return uploadText(accessToken, folderId, name, mimeType, body);
}

/** 用語辞書を glossary.json / glossary.md として書き出す */
export async function mirrorGlossary(
  db: Db,
  userId: string,
  accessToken: string,
  backupFolderId: string,
): Promise<GlossaryMirrorResult> {
  const terms = await readTerms(db, userId);
  const settings = await getSettings(db, userId);
  const now = new Date();

  const folderId = await ensureFolder(accessToken, backupFolderId, GLOSSARY_FOLDER_NAME);

  const jsonFileId = await writeOrCreate(
    accessToken,
    folderId,
    settings.glossaryJsonFileId,
    GLOSSARY_JSON_NAME,
    JSON_MIME,
    JSON.stringify(buildGlossaryJson(terms, now), null, 2),
  );

  const mdFileId = await writeOrCreate(
    accessToken,
    folderId,
    settings.glossaryMdFileId,
    GLOSSARY_MD_NAME,
    MARKDOWN_MIME,
    buildGlossaryMarkdown(terms, now),
  );

  // 両方書けてから記録する。片方で落ちたら次の実行でもう一度やり直す
  await saveSettings(db, userId, {
    glossaryJsonFileId: jsonFileId,
    glossaryMdFileId: mdFileId,
    glossarySyncedAt: now,
  });

  return { terms: terms.length, syncedAt: now.toISOString(), folderId };
}

/**
 * 書き出したものを捨てる。復元のあとに呼ぶ。
 *
 * 復元は用語を総入れ替えするので、覚えているファイル id が
 * **復元前の中身を指したまま**残る。フォルダごと消して作り直させる。
 * 消せなくても復元自体は成功なので、ここでは投げない。
 */
export async function discardGlossaryMirror(
  db: Db,
  userId: string,
  accessToken: string,
  backupFolderId: string,
): Promise<void> {
  try {
    const folder = await findFolder(accessToken, backupFolderId, GLOSSARY_FOLDER_NAME);
    if (folder) await deleteFile(accessToken, folder);
  } catch (error) {
    console.error('[glossary-mirror] failed to discard the glossary folder:', error);
  }

  // Drive 側を消せたかに関わらず、id は捨てる（古い中身を上書きし続けないため）
  await saveSettings(db, userId, {
    glossaryJsonFileId: null,
    glossaryMdFileId: null,
    glossarySyncedAt: null,
  });
}
