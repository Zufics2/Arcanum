import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";

import { API_URL } from "@/lib/config";
import { useAuthStore } from "@/stores/authStore";

// withCredentials: the httpOnly session cookie must travel with /api/auth/ requests.
export const api = axios.create({ baseURL: API_URL, withCredentials: true });

api.interceptors.request.use((config) => {
  const access = useAuthStore.getState().session?.access;
  if (access) config.headers.Authorization = `Bearer ${access}`;
  return config;
});

// Public auth endpoints: a 401 there is a real answer, not an expired access token.
const NO_REFRESH = [
  "/auth/login/",
  "/auth/register/",
  "/auth/salt/",
  "/auth/refresh/",
  "/auth/session/",
  "/auth/logout/",
  "/auth/recovery/verify/",
  "/auth/recovery/reset/",
];

// One shared refresh request, so parallel 401s don't trigger several refreshes.
let refreshing: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  const { session, setAccess } = useAuthStore.getState();
  if (!session) throw new Error("No session");
  const { data } = await axios.post<{ access: string }>(`${API_URL}/auth/refresh/`, { refresh: session.refresh });
  setAccess(data.access);
  return data.access;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;

    if (
      error.response?.status !== 401 ||
      !original ||
      original._retried ||
      NO_REFRESH.some((url) => original.url?.startsWith(url))
    ) {
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
      useAuthStore.getState().endActive();
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
    // Field errors: {"field": ["message", ...]}
    const first = data && Object.values(data).find((v) => Array.isArray(v) && typeof v[0] === "string");
    if (first) return (first as string[])[0];
  }
  return fallback;
}

/** True if a DRF field error contains the given message. */
export function hasFieldError(error: unknown, field: string, message?: string): boolean {
  if (!axios.isAxiosError(error)) return false;
  const value = (error.response?.data as Record<string, unknown> | undefined)?.[field];
  return Array.isArray(value) && (message === undefined || value.includes(message));
}
