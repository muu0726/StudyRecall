import { Hono } from 'hono';
import { getDb, type AppEnv } from '../lib/db';
import { listCategoryDtos } from './categories';
import { listStudyLogs } from './study-logs';
import { listTagCounts } from './tags';
import { listNotebookDtos } from './notebooks';
import { listGlossaryTerms } from './glossary';
import type { BootstrapResponse, BootstrapSection } from '../../shared/types';

/**
 * 起動時にまとめて配る 1 本。
 *
 * 画面を開くたびに一覧を 5 本並べて叩いていた（ログイン確認もその回数だけ走っていた）。
 * 中身は同じ関数を呼ぶだけで、**重複した組み立ては持たない**。
 *
 * **1 つ失敗しても残りは返す。** 以前から「ノートだけ失敗」は部分的に成功する作りで、
 * ここで 500 にすると今より悪くなる。失敗した区画は null にして `errors` に理由を入れる
 * （今まで画面に出ていなかった用語辞書の失敗も、これで出せるようになる）。
 */

function reasonOf(result: PromiseRejectedResult): string {
  const error = result.reason;
  return error instanceof Error ? error.message : String(error);
}

export const bootstrapRoute = new Hono<AppEnv>().get('/', async (c) => {
  const db = getDb(c.env);
  const userId = c.get('userId');

  const [categories, studyLogs, tags, notebooks, glossary] = await Promise.allSettled([
    listCategoryDtos(db, userId),
    listStudyLogs(db, userId),
    listTagCounts(db, userId),
    listNotebookDtos(db, userId),
    listGlossaryTerms(db, userId),
  ]);

  const errors: Partial<Record<BootstrapSection, string>> = {};
  const note = (section: BootstrapSection, result: PromiseSettledResult<unknown>) => {
    if (result.status === 'rejected') {
      console.error(`[bootstrap] ${section} failed:`, result.reason);
      errors[section] = reasonOf(result);
    }
  };
  note('categories', categories);
  note('studyLogs', studyLogs);
  note('tags', tags);
  note('notebooks', notebooks);
  note('glossary', glossary);

  const response: BootstrapResponse = {
    categories: categories.status === 'fulfilled' ? categories.value : null,
    studyLogs: studyLogs.status === 'fulfilled' ? studyLogs.value : null,
    tags: tags.status === 'fulfilled' ? tags.value : null,
    notebooks: notebooks.status === 'fulfilled' ? notebooks.value : null,
    glossary: glossary.status === 'fulfilled' ? glossary.value : null,
    ...(Object.keys(errors).length > 0 ? { errors } : {}),
  };
  return c.json(response);
});
