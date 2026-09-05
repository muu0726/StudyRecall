import { createAuthClient } from 'better-auth/react';

/**
 * Better Auth のクライアント。API と同一オリジンで動くため baseURL は指定しない。
 *
 * 分割代入で re-export すると、composite プロジェクトでは推論した型を名前で参照できず
 * TS2883 になる。呼び出し側は authClient.useSession() のように使う。
 */
export const authClient = createAuthClient({
  basePath: '/api/auth',
});
