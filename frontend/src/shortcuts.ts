/** Keyboard shortcuts are global (C / B / arrows / "/"), so every handler has
 * to stay out of the way of normal typing and of modal dialogs. One shared
 * check keeps those rules in one place:
 *
 * - modifier combos (Ctrl/Cmd/Alt+key) belong to the browser and OS;
 * - text fields, selects and range sliders use the keys themselves (a slider
 *   uses the arrows) -- hijacking them would make forms unusable;
 * - while a modal dialog is open nothing behind it should react;
 * - IME composition must never be interpreted as a command.
 */
export function shouldIgnoreShortcut(e: KeyboardEvent): boolean {
  if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return true;

  const target = e.target;
  if (target instanceof HTMLElement) {
    const tag = target.tagName;
    if (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      target.isContentEditable
    ) {
      return true;
    }
  }

  return document.querySelector("dialog[open]") !== null;
}

/** Advance through `items` from `current`, wrapping around. */
export function cycle<T>(items: readonly T[], current: T, step = 1): T {
  const index = items.indexOf(current);
  const base = index < 0 ? 0 : index;
  return items[(base + step + items.length) % items.length];
}
