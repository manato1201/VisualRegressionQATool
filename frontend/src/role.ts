import { createContext, useContext } from "react";

export type Role = "viewer" | "operator" | "admin";

const RANK: Record<Role, number> = { viewer: 0, operator: 1, admin: 2 };

/** 権限の判断は、常にサーバー側(403)。これは「押せない理由」を先に見せるための表示だけ。 */
export function roleAtLeast(role: Role, minimum: Role): boolean {
  return RANK[role] >= RANK[minimum];
}

/** 認証が off のときは admin 扱い(従来どおり、全部使える)。 */
export const RoleContext = createContext<Role>("admin");

/**
 * 開発者・デバッグ向けの機能(しきい値ラボ)が使えるか。サーバーが /api/auth/me で教える(本番では既定で無効・有効でも admin だけ。
 * 認証が off のローカルでは true)。これは表示の出し分けだけで、サーバーも同じ判断で拒否する(404 / 403)。
 */
export const DebugContext = createContext<boolean>(true);

export function useDebug(): boolean {
  return useContext(DebugContext);
}

export function useCan(): (minimum: Role) => boolean {
  const role = useContext(RoleContext);
  return (minimum) => roleAtLeast(role, minimum);
}

/** ボタンの title に出す、足りない権限の説明。足りていれば undefined。 */
export function needTitle(can: boolean, minimum: Role): string | undefined {
  return can ? undefined : `この操作には ${minimum} 以上の権限が必要です`;
}
