"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntdApp, ConfigProvider, theme } from "antd";
import ruRU from "antd/locale/ru_RU";
import dayjs from "dayjs";
import "dayjs/locale/ru";
import { useEffect, useState, type ReactNode } from "react";

import { restoreSession } from "@/lib/auth";
import { buildTheme } from "@/lib/theme";
import { useAuthStore } from "@/stores/authStore";
import { THEME_STORAGE_KEY, useThemeStore, type ThemeMode } from "@/stores/themeStore";

dayjs.locale("ru");

/** Applies the theme to <body>, which antd components do not style themselves. */
function ThemedBody() {
  const { token } = theme.useToken();
  const mode = useThemeStore((s) => s.mode);

  useEffect(() => {
    document.body.style.background = token.colorBgLayout;
    document.body.style.color = token.colorText;
    document.documentElement.style.colorScheme = mode;
  }, [token.colorBgLayout, token.colorText, mode]);

  return null;
}

export default function Providers({ children }: { children: ReactNode }) {
  // One QueryClient per browser session; created lazily so it is not shared between requests on the server.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
      }),
  );
  const mode = useThemeStore((s) => s.mode);

  // Decrypted names live in the query cache: wipe it whenever the active account changes or ends.
  useEffect(
    () =>
      useAuthStore.subscribe((state, prev) => {
        if (prev.session?.masterKey !== state.session?.masterKey) queryClient.clear();
      }),
    [queryClient],
  );

  // After a reload: find out from the httpOnly cookie who was logged in (for the unlock screen).
  useEffect(() => {
    void restoreSession();
  }, []);

  // Theme: saved choice, otherwise the OS preference. Read after mount to keep SSR markup stable.
  useEffect(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    useThemeStore.getState().setMode(saved ?? (prefersDark ? "dark" : "light"));

    return useThemeStore.subscribe((state) => localStorage.setItem(THEME_STORAGE_KEY, state.mode));
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider locale={ruRU} theme={buildTheme(mode)}>
        <ThemedBody />
        <AntdApp>{children}</AntdApp>
      </ConfigProvider>
    </QueryClientProvider>
  );
}
