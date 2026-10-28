import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

/** Must match the pre-paint script in web/index.html. */
export const THEME_KEY = "ava-theme";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

/** The saved choice, or null when there is none or storage is unavailable. */
export function readStoredTheme(storage: Storage | undefined): Theme | null {
  try {
    const v = storage?.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

export function writeStoredTheme(storage: Storage | undefined, theme: Theme): void {
  try {
    storage?.setItem(THEME_KEY, theme);
  } catch {
    // Private windows and blocked storage: the choice lasts for this page only.
  }
}

/** A saved choice wins; otherwise follow the system setting. */
export function resolveTheme(stored: Theme | null, systemDark: boolean): Theme {
  return stored ?? (systemDark ? "dark" : "light");
}

function localStore(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function systemDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

/** Current theme plus a toggle; sets `data-theme` on <html> and remembers the choice. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() =>
    resolveTheme(readStoredTheme(localStore()), systemDark()),
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Follow the system until the person picks a theme themselves.
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const onChange = () => {
      if (!readStoredTheme(localStore())) setTheme(mq.matches ? "dark" : "light");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const toggle = useCallback(() => {
    setTheme((t) => {
      const next: Theme = t === "dark" ? "light" : "dark";
      writeStoredTheme(localStore(), next);
      return next;
    });
  }, []);

  return { theme, toggle };
}
