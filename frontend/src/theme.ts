export type ThemeMode = "light" | "dark";

const STORAGE_KEY = "vrqa-theme";

/** Saved choice first, then the OS preference, then light. Storage access can
 * throw (private mode, blocked cookies), so it never decides anything alone. */
export function getInitialTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // fall through to the OS preference
  }
  const prefersDark =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
}

/** Reflect the theme on <html>. `persist` is false for the initial paint so an
 * OS-derived default isn't saved as if the user had chosen it. */
export function applyTheme(mode: ThemeMode, persist = true): void {
  document.documentElement.dataset.theme = mode;
  if (!persist) return;
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // the theme still applies for this session
  }
}
