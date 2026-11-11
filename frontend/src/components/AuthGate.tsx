import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api, describeApiError, type Me } from "../api";
import { DebugContext, RoleContext } from "../role";

/**
 * VRQA_AUTH=required のとき、ログインするまで画面を出さない。
 * off(既定)のときは何も挟まず、そのまま子を出す。
 * 権限の判断は常にサーバー側(403)。ここは「入口」と「誰で入っているか」の表示だけ。
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setMe(await api.me());
      setError(null);
    } catch (e) {
      setError(describeApiError(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true);
    try {
      setMe(await api.login(apiKey.trim()));
      setApiKey(""); // 画面にもメモリにも残さない
      setError(null);
    } catch (e) {
      setError(describeApiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function onLogout() {
    await api.logout();
    await refresh();
  }

  if (error && !me) {
    return (
      <main className="auth-gate" role="alert">
        <p>サーバーに接続できません: {error}</p>
        <button type="button" onClick={() => void refresh()}>再試行</button>
      </main>
    );
  }
  if (!me) return null;

  if (me.mode === "off" || me.authenticated) {
    return (
      <>
        {me.mode === "required" && (
          <div className="auth-strip" style={{ display: "flex", gap: 8, justifyContent: "flex-end", padding: "4px 16px", fontSize: 12 }}>
            <span>
              {me.name}({me.role})
            </span>
            <button type="button" onClick={() => void onLogout()}>ログアウト</button>
          </div>
        )}
        <RoleContext.Provider value={me.role ?? "admin"}>
          <DebugContext.Provider value={me.debug === true}>{children}</DebugContext.Provider>
        </RoleContext.Provider>
      </>
    );
  }

  return (
    <main
      className="auth-gate"
      style={{ maxWidth: 420, margin: "12vh auto", padding: "0 16px", display: "grid", gap: 12 }}
    >
      <h1 style={{ fontSize: 20 }}>VisualRegressionQATool</h1>
      <p>この環境は認証が必要です。管理者から受け取った API キーを入れてください。</p>
      <form onSubmit={onSubmit} style={{ display: "grid", gap: 8 }}>
        <label htmlFor="vrqa-api-key">API キー</label>
        <input
          id="vrqa-api-key"
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          required
        />
        <button type="submit" disabled={busy || !apiKey.trim()}>
          ログイン
        </button>
      </form>
      {error && (
        <p role="alert" style={{ color: "var(--color-fail)" }}>
          {error}
        </p>
      )}
    </main>
  );
}
