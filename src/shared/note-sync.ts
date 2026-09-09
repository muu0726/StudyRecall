import { joinPath, type NotePath } from './note-export';

/**
 * ノート → Google ドライブの差分を出す。**純粋関数だけ。**
 *
 * `task-sync.ts` と同じ作りで、「何をするか」の一覧を返すところまでが仕事。
 * 実際に Drive を叩くのはルートの仕事にして、判断はすべてテストできる層に置く。
 *
 * **一方通行。** Drive 側で編集されたかは見ない（見るには Markdown から
 * タイトルとカテゴリを逆に読む処理と、競合の解決が要る）。あちらで直した内容は
 * 次の書き出しで上書きされる。この割り切りは画面にも明記する。
 */

export interface DesiredNote {
  id: string;
  path: NotePath;
  /** ISO。DB の updatedAt */
  updatedAt: string;
}

/** DB に覚えてある「最後に Drive へ書いたときの状態」 */
export interface SyncedNote {
  id: string;
  driveFileId: string | null;
  /** 'カテゴリ/親/子.md'。**親の改名を検出するために要る** */
  drivePath: string | null;
  /** ISO */
  driveSyncedAt: string | null;
}

export type NoteSyncAction =
  /** まだ Drive に無い */
  | { kind: 'create'; id: string }
  /** 中身が変わった */
  | { kind: 'update'; id: string; driveFileId: string }
  /** 置き場所だけ変わった（自分か祖先の改名、カテゴリの移動） */
  | { kind: 'move'; id: string; driveFileId: string; from: string }
  | { kind: 'move-and-update'; id: string; driveFileId: string; from: string }
  /** ゴミ箱に入った・消された */
  | { kind: 'delete'; id: string; driveFileId: string };

export interface NoteSyncPlan {
  actions: NoteSyncAction[];
  /** 予算に入りきらなかった件数。次の実行で片付く */
  remaining: number;
}

/**
 * 何をすべきかを決める。
 *
 * **`updatedAt` だけでは足りない。** 親ノートやカテゴリを改名すると、子の置き場所は
 * 変わるのに子の `updatedAt` は変わらない。最後に書いた場所（`drivePath`）を
 * 突き合わせて初めて「移動が要る」と分かる。
 *
 * `budget` は 1 回の実行で叩く Drive の回数の上限。Workers の subrequest 上限
 * （無料プランは 1 リクエストあたり 50）に収めるためで、変わっていないものは
 * 飛ばすので**回を重ねれば必ず追いつく**。
 */
export function planNoteSync(
  desired: readonly DesiredNote[],
  synced: readonly SyncedNote[],
  options: { budget: number },
): NoteSyncPlan {
  const syncedById = new Map(synced.map((row) => [row.id, row]));
  const desiredIds = new Set(desired.map((note) => note.id));

  /*
   * **削除を先に積む。** 名前が衝突したときの連番（-2）は place の計算で決まるので、
   * 消えるべきファイルを先に片付けたほうが、Drive 上に一時的な重複が残りにくい。
   */
  const deletes: NoteSyncAction[] = [];
  for (const row of synced) {
    if (!desiredIds.has(row.id) && row.driveFileId) {
      deletes.push({ kind: 'delete', id: row.id, driveFileId: row.driveFileId });
    }
  }

  const writes: NoteSyncAction[] = [];
  for (const note of desired) {
    const row = syncedById.get(note.id);
    if (!row?.driveFileId) {
      writes.push({ kind: 'create', id: note.id });
      continue;
    }

    const wantPath = joinPath(note.path);
    const moved = row.drivePath !== wantPath;
    // driveSyncedAt が無いなら、いつ書いたか分からない＝書き直す
    const changed =
      row.driveSyncedAt === null || Date.parse(note.updatedAt) > Date.parse(row.driveSyncedAt);

    if (moved && changed) {
      writes.push({
        kind: 'move-and-update',
        id: note.id,
        driveFileId: row.driveFileId,
        from: row.drivePath ?? '',
      });
    } else if (moved) {
      writes.push({
        kind: 'move',
        id: note.id,
        driveFileId: row.driveFileId,
        from: row.drivePath ?? '',
      });
    } else if (changed) {
      writes.push({ kind: 'update', id: note.id, driveFileId: row.driveFileId });
    }
    // どちらも変わっていなければ何もしない。ここが 2 回目以降を速くする。
  }

  const all = [...deletes, ...writes];
  const budget = Math.max(0, options.budget);
  return { actions: all.slice(0, budget), remaining: Math.max(0, all.length - budget) };
}
