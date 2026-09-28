import { useCallback, useEffect, useState } from 'react';
import type {
  CreatePortalLinkRequest,
  PortalLinkDTO,
  UpdatePortalLinkRequest,
} from '../../shared/types';
import { api } from '../lib/api';
import { useRevalidateOnFocus } from './useRevalidateOnFocus';

/**
 * ポータルのリンク。真実の情報源はサーバー（portal_links）にある。
 *
 * **楽観更新はしない。** 追加も編集も削除も結果をそのまま見せる操作で、
 * 一覧は数十件なので往復の待ちが問題にならない。
 */
export function usePortalLinks() {
  const [links, setLinks] = useState<PortalLinkDTO[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const { links: next } = await api.listPortalLinks();
      setLinks(next);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useRevalidateOnFocus(() => reload());

  /** 失敗したら理由の文言を返す（成功なら null）。呼び出し側がトーストに出す */
  const run = useCallback(async (action: () => Promise<unknown>): Promise<string | null> => {
    setIsSaving(true);
    try {
      await action();
      return null;
    } catch (actionError) {
      return actionError instanceof Error ? actionError.message : String(actionError);
    } finally {
      setIsSaving(false);
    }
  }, []);

  const create = useCallback(
    async (body: CreatePortalLinkRequest) => {
      const message = await run(async () => {
        const { link } = await api.createPortalLink(body);
        setLinks((previous) => [...previous, link]);
      });
      return message;
    },
    [run],
  );

  const update = useCallback(
    async (id: string, body: UpdatePortalLinkRequest) => {
      const message = await run(async () => {
        const { link } = await api.updatePortalLink(id, body);
        setLinks((previous) => previous.map((item) => (item.id === id ? link : item)));
      });
      return message;
    },
    [run],
  );

  const remove = useCallback(
    async (id: string) => {
      const message = await run(async () => {
        await api.deletePortalLink(id);
        setLinks((previous) => previous.filter((item) => item.id !== id));
      });
      return message;
    },
    [run],
  );

  /**
   * 並べ替え。**先に画面を並べ替えてから送る。**
   * 押した瞬間に動かないと、並べ替えは操作している感じがしない。
   * 失敗したらサーバーの並びに戻す（戻せなければ error に出す）。
   */
  const reorder = useCallback(
    async (ids: string[]) => {
      const previous = links;
      setLinks((current) => {
        const byId = new Map(current.map((link) => [link.id, link]));
        return ids.flatMap((id) => {
          const link = byId.get(id);
          return link ? [link] : [];
        });
      });
      try {
        const result = await api.reorderPortalLinks(ids);
        setLinks(result.links);
        return null;
      } catch (reorderError) {
        setLinks(previous);
        return reorderError instanceof Error ? reorderError.message : String(reorderError);
      }
    },
    [links],
  );

  /** 取り込み。件数は呼び出し側が文言にする */
  const importLinks = useCallback(async (body: CreatePortalLinkRequest[]) => {
    setIsSaving(true);
    try {
      const result = await api.importPortalLinks({ links: body });
      setLinks(result.links);
      return { ok: true as const, ...result };
    } catch (importError) {
      return {
        ok: false as const,
        error: importError instanceof Error ? importError.message : String(importError),
      };
    } finally {
      setIsSaving(false);
    }
  }, []);

  return {
    links,
    isLoading,
    isSaving,
    error,
    reload,
    create,
    update,
    remove,
    reorder,
    importLinks,
  };
}

export type PortalLinksState = ReturnType<typeof usePortalLinks>;
