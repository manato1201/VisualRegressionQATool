import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../theme.css";
import { AuthGate } from "../components/AuthGate";
import { applyTheme, getInitialTheme } from "../theme";
import AdminApp from "./AdminApp";

// 管理者だけの画面(基準画像の更新・撮影画像の削除)。メイン画面(index.html)とは別のエントリー・別のバンドル。
applyTheme(getInitialTheme(), false);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthGate>
      <AdminApp />
    </AuthGate>
  </StrictMode>,
);
