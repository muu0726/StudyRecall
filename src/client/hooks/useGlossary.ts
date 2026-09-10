import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CreateGlossaryTermRequest,
  GlossaryTermDTO,
  UpdateGlossaryTermRequest,
} from '../../shared/types';
import { api, asGlossaryDuplicate } from '../lib/api';
import { useToast } from '../components/Toast';

/**
 * 用語辞書のデータ。`useNotebooks` と同じ作法で書いてある。
 * - `reload` の失敗は `error`（画面に居座る Banner）
 * - 変更の失敗はトースト。**投げ返さず null を返す**
 *
 * **絞り込みはここでしない。** 取ってきた全件をそのまま返し、
 * 検索・タグ・習得ステータスは画面側が `filterGlossaryTerms` で畳む。
 * ここで畳むと「打鍵のたびに取得」に戻ってしまう。
 */

export interface GlossaryApi {
  terms: GlossaryTermDTO[];
  isLoading: boolean;
  error: string | null;
  /** GLOSSARY_LIMIT で打ち切られた。true なら手元の検索が全件を見ていない */
  truncated: boolean;
  isSaving: boolean;
  reload: () => Promise<void>;
  /** 重複（409）のときは既にある用語を返す。呼び出し側が「開いて編集」へ誘導する */
  create: (
    body: CreateGlossaryTermRequest,
  ) => Promise<{ term: GlossaryTermDTO; duplicate: boolean } | null>;
  update: (id: string, body: UpdateGlossaryTermRequest) => Promise<GlossaryTermDTO | null>;
  remove: (id: string, cards: 'keep' | 'delete') => Promise<boolean>;
}

export function useGlossary(): GlossaryApi {
  const { showToast } = useToast();
  const [terms, setTerms] = useState<GlossaryTermDTO[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // アンマウント後の setState を避ける（画面を離れながら保存したときに出る）
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    try {
      const result = await api.listGlossary();
      if (!aliveRef.current) return;
      setTerms(result.terms);
      setTruncated(result.truncated);
      setError(null);
    } catch (loadError) {
      if (!aliveRef.current) return;
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      if (aliveRef.current) setIsLoading(false);
    }
  }, []);

  const create = useCallback(
    async (body: CreateGlossaryTermRequest) => {
      setIsSaving(true);
      try {
        const { term } = await api.createGlossaryTerm(body);
        await reload();
        return { term, duplicate: false };
      } catch (createError) {
        // 「同じ用語が既にある」は失敗ではなく分岐。トーストは呼び出し側に任せる
        const duplicate = asGlossaryDuplicate(createError);
        if (duplicate) return { term: duplicate.term, duplicate: true };

        showToast(createError instanceof Error ? createError.message : String(createError), {
          kind: 'error',
        });
        return null;
      } finally {
        if (aliveRef.current) setIsSaving(false);
      }
    },
    [reload, showToast],
  );

  const update = useCallback(
    async (id: string, body: UpdateGlossaryTermRequest) => {
      setIsSaving(true);
      try {
        const { term } = await api.updateGlossaryTerm(id, body);
        // 一覧の並びは更新順なので、差し替えだけだと順番が実際とずれる
        await reload();
        return term;
      } catch (updateError) {
        const duplicate = asGlossaryDuplicate(updateError);
        showToast(
          duplicate
            ? duplicate.error
            : updateError instanceof Error
              ? updateError.message
              : String(updateError),
          { kind: 'error' },
        );
        return null;
      } finally {
        if (aliveRef.current) setIsSaving(false);
      }
    },
    [reload, showToast],
  );

  const remove = useCallback(
    async (id: string, cards: 'keep' | 'delete') => {
      try {
        const result = await api.deleteGlossaryTerm(id, { cards });
        await reload();
        showToast(
          result.deletedCards > 0
            ? `用語とカード ${result.deletedCards} 枚を削除しました`
            : '用語を削除しました',
          { kind: 'success' },
        );
        return true;
      } catch (deleteError) {
        showToast(deleteError instanceof Error ? deleteError.message : String(deleteError), {
          kind: 'error',
        });
        return false;
      }
    },
    [reload, showToast],
  );

  return { terms, isLoading, error, truncated, isSaving, reload, create, update, remove };
}
