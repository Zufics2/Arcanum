import { theme, type ThemeConfig } from "antd";

import type { ThemeMode } from "@/stores/themeStore";

/**
 * Brand color: deep indigo. Dark mode uses a lighter shade of the same hue, because the deep one
 * is unreadable on a dark background (2.3:1 contrast vs 4.1:1). Hover/active shades are derived by antd.
 */
export const BRAND_COLOR = { light: "#4338ca", dark: "#6366f1" } as const;

export function buildTheme(mode: ThemeMode): ThemeConfig {
  const brand = BRAND_COLOR[mode];
  return {
    algorithm: mode === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: { colorPrimary: brand, colorLink: brand },
  };
}
