import { create } from "zustand";

export type ThemeMode = "light" | "dark";

/** UI theme preference. Not sensitive, so (unlike keys) it may be saved in localStorage. */
export const THEME_STORAGE_KEY = "arcanum-theme";

interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}

export const useThemeStore = create<ThemeState>()((set) => ({
  mode: "light",
  setMode: (mode) => set({ mode }),
  toggle: () => set((s) => ({ mode: s.mode === "light" ? "dark" : "light" })),
}));
