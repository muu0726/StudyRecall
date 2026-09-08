/**
 * ローカルのタスクと Google Tasks を突き合わせる判断。
 *
 * **ここに Google API を持ち込まない。** 同期でいちばん壊れやすいのはこの判断で、
 * ネットワークに触らない純粋関数にしておけばテストで固定できる。
 * 実際の HTTP は worker/lib/google-tasks.ts が担当し、ここが返す指示に従うだけ。
 *
 * 日付は **'YYYY-MM-DD' の文字列のまま**扱う。Date を経由すると、
 * 端末やサーバーのタイムゾーン次第で 1 日ずれる（Google Tasks の due は
 * 時刻部分に意味が無く、UTC 深夜として返ってくる）。
 */

/** 同期の判断に要るぶんだけのローカル行 */
export interface LocalTask {
  id: string;
  googleTaskId: string | null;
  title: string;
  memo: string | null;
  /** 'YYYY-MM-DD' */
  dueDate: string | null;
  isCompleted: boolean;
  /** 墓標。ISO 文字列。null なら生きている */
  deletedAt: string | null;
  /** ローカルの最終更新。ISO 文字列 */
  updatedAt: string;
  /** 最後に取り込んだ Google 側の updated。ISO 文字列 */
  googleUpdatedAt: string | null;
  syncState: 'pending' | 'synced';
}

/** Google Tasks の tasks.list が返す 1 件（使う項目だけ） */
export interface RemoteTask {
  id: string;
  title: string;
  notes: string | null;
  /** RFC3339。実質は日付だけ */
  due: string | null;
  status: 'needsAction' | 'completed';
  /** RFC3339 */
  updated: string;
  deleted: boolean;
}

export type SyncAction =
  /** Google にしかない → ローカルに作る */
  | { kind: 'create-local'; remote: RemoteTask }
  /** Google 側が新しい → ローカルを合わせる */
  | { kind: 'update-local'; id: string; remote: RemoteTask }
  /** Google 側で消された → ローカルも消す */
  | { kind: 'delete-local'; id: string }
  /** ローカルにしかない → Google に作る */
  | { kind: 'create-remote'; id: string }
  /** ローカルが新しい → Google を合わせる */
  | { kind: 'update-remote'; id: string; googleTaskId: string }
  /** ローカルで消された → Google からも消す */
  | { kind: 'delete-remote'; id: string; googleTaskId: string }
  /** 墓標だが Google 側に対応が無い → 行ごと捨ててよい */
  | { kind: 'purge-local'; id: string };

/** ISO / RFC3339 を比較用のミリ秒に。壊れていれば 0 */
function ms(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * 取り込みと送信の両方の指示を作る。
 *
 * **差分取得（updatedMin）を前提にしている。** そのため「リモートの一覧に無い」ことは
 * 削除ではなく「変わっていない」を意味する。削除は `deleted: true` の行でしか判断しない
 * （だから list には showDeleted を付ける）。ここを取り違えると、
 * 更新の無いタスクが同期のたびに全部消える。
 */
export function reconcile(locals: LocalTask[], remotes: RemoteTask[]): SyncAction[] {
  const byGoogleId = new Map<string, RemoteTask>();
  for (const remote of remotes) byGoogleId.set(remote.id, remote);

  const actions: SyncAction[] = [];
  const claimed = new Set<string>();

  for (const local of locals) {
    const remote = local.googleTaskId ? byGoogleId.get(local.googleTaskId) : undefined;
    if (remote) claimed.add(remote.id);

    // 墓標が最優先。生死の判断を更新の判断より先に済ませる。
    if (local.deletedAt !== null) {
      if (!local.googleTaskId) {
        actions.push({ kind: 'purge-local', id: local.id });
      } else if (remote?.deleted) {
        // 向こうでも消えている。伝えることはもう無い。
        actions.push({ kind: 'purge-local', id: local.id });
      } else {
        actions.push({
          kind: 'delete-remote',
          id: local.id,
          googleTaskId: local.googleTaskId,
        });
      }
      continue;
    }

    if (!local.googleTaskId) {
      actions.push({ kind: 'create-remote', id: local.id });
      continue;
    }

    if (!remote) {
      // 差分に出てこない ＝ 向こうは変わっていない。こちらに未送信があれば送る。
      if (local.syncState === 'pending') {
        actions.push({
          kind: 'update-remote',
          id: local.id,
          googleTaskId: local.googleTaskId,
        });
      }
      continue;
    }

    if (remote.deleted) {
      actions.push({ kind: 'delete-local', id: local.id });
      continue;
    }

    /*
     * 「向こうが変わったか」は updated の絶対値ではなく、
     * **最後に取り込んだ updated から動いたか**で見る。
     * こちらが送った直後、Google は updated を我々の時刻より後に付けるので、
     * 素朴に比べると自分の変更を毎回引き戻すことになる。
     */
    const remoteChanged =
      local.googleUpdatedAt === null || ms(remote.updated) > ms(local.googleUpdatedAt);
    const localChanged = local.syncState === 'pending';

    if (localChanged && remoteChanged) {
      // 両方動いた。新しい方を採る。同時刻ならローカルを残す（書いた本人の意図を優先）。
      if (ms(remote.updated) > ms(local.updatedAt)) {
        actions.push({ kind: 'update-local', id: local.id, remote });
      } else {
        actions.push({
          kind: 'update-remote',
          id: local.id,
          googleTaskId: local.googleTaskId,
        });
      }
    } else if (localChanged) {
      actions.push({ kind: 'update-remote', id: local.id, googleTaskId: local.googleTaskId });
    } else if (remoteChanged) {
      actions.push({ kind: 'update-local', id: local.id, remote });
    }
  }

  for (const remote of remotes) {
    // 削除済みで、こちらに存在しないものは取り込まない（墓標を増やすだけ）
    if (claimed.has(remote.id) || remote.deleted) continue;
    actions.push({ kind: 'create-local', remote });
  }

  return actions;
}

// ---------------------------------------------------------------------------
// 期日の変換。**文字列のまま**扱うのが肝。
// ---------------------------------------------------------------------------

/** 'YYYY-MM-DD' → Google Tasks の due（RFC3339・UTC 深夜） */
export function toGoogleDue(dueDate: string | null): string | null {
  if (!dueDate) return null;
  return `${dueDate}T00:00:00.000Z`;
}

/**
 * Google Tasks の due → 'YYYY-MM-DD'。
 * **Date を経由しない。** パースして再フォーマットすると、実行環境のタイムゾーン次第で
 * 前日になる（Google は UTC 深夜で返すため、UTC より西の地域で 1 日ずれる）。
 */
export function fromGoogleDue(due: string | null | undefined): string | null {
  if (!due) return null;
  const matched = /^(\d{4}-\d{2}-\d{2})/.exec(due);
  return matched ? matched[1] : null;
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** JST における「今日」を 'YYYY-MM-DD' で返す。クライアントとサーバーで同じ答えにする */
export function todayInJst(now: Date = new Date()): string {
  return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' どうしの日数差（a - b）。両方 UTC 深夜として数えるのでずれない */
export function daysBetween(a: string, b: string): number {
  const DAY_MS = 24 * 60 * 60 * 1000;
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS);
}

// ---------------------------------------------------------------------------
// 期日超過の繰り越し表示
// ---------------------------------------------------------------------------

/** グルーピングに要るぶんだけ。DTO でもローカル行でも通るようにしておく */
export interface GroupableTask {
  dueDate: string | null;
  isCompleted: boolean;
}

export interface TaskGroups<T extends GroupableTask> {
  /** 期日を過ぎた未完了。今日の一覧に繰り越して見せる */
  overdue: { task: T; overdueDays: number }[];
  today: T[];
  upcoming: T[];
  noDue: T[];
  completed: T[];
}

/**
 * 期日で仕分ける。
 *
 * **`dueDate` は書き換えない。** 「繰り越し」は表示の話であって、
 * 期日を今日へ動かすと Google 側の予定まで勝手に変わってしまう。
 * いつのぶんだったかも分からなくなるので、超過日数を添えて見せるだけにする。
 */
export function groupTasks<T extends GroupableTask>(
  tasks: T[],
  today: string = todayInJst(),
): TaskGroups<T> {
  const groups: TaskGroups<T> = {
    overdue: [],
    today: [],
    upcoming: [],
    noDue: [],
    completed: [],
  };

  for (const task of tasks) {
    if (task.isCompleted) {
      groups.completed.push(task);
      continue;
    }
    if (!task.dueDate) {
      groups.noDue.push(task);
      continue;
    }
    const diff = daysBetween(task.dueDate, today);
    if (diff < 0) groups.overdue.push({ task, overdueDays: -diff });
    else if (diff === 0) groups.today.push(task);
    else groups.upcoming.push(task);
  }

  // 超過は古いものほど上。放置され続けたものが埋もれない。
  groups.overdue.sort((a, b) => b.overdueDays - a.overdueDays);
  groups.upcoming.sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  return groups;
}
