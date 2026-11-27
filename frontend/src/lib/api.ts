import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";

import { API_URL } from "@/lib/config";
import { useAuthStore } from "@/stores/authStore";

export const api = axios.create({ baseURL: API_URL });

api.interceptors.request.use((config) => {
  const { access } = useAuthStore.getState();
  if (access) config.headers.Authorization = `Bearer ${access}`;
  return config;
});

// One shared refresh request, so parallel 401s don't trigger several refreshes.
let refreshing: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  const { refresh, setAccess } = useAuthStore.getState();
  if (!refresh) throw new Error("No refresh token");
  const { data } = await axios.post<{ access: string }>(`${API_URL}/auth/refresh/`, { refresh });
  setAccess(data.access);
  return data.access;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;
    const isAuthCall = original?.url?.startsWith("/auth/");

    if (error.response?.status !== 401 || !original || original._retried || isAuthCall) {
      throw error;
    }

    original._retried = true;
    try {
      refreshing ??= refreshAccessToken().finally(() => {
        refreshing = null;
      });
      const access = await refreshing;
      original.headers.Authorization = `Bearer ${access}`;
      return api(original);
    } catch {
      useAuthStore.getState().logout();
      throw error;
    }
  },
);

/** Extracts a human-readable message from a DRF error response. */
export function apiErrorMessage(error: unknown, fallback = "Что-то пошло не так. Попробуйте ещё раз."): string {
  if (axios.isAxiosError(error)) {
    if (!error.response) return "Сервер недоступен.";
    const data = error.response.data as Record<string, unknown> | undefined;
    if (data && typeof data.detail === "string") return data.detail;
  }
  return fallback;
}
