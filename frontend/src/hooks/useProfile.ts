"use client";

import { useQuery } from "@tanstack/react-query";

import { fetchCustomAvatarUrl, getMe } from "@/lib/profile";
import { useAuthStore } from "@/stores/authStore";

export function useMe() {
  const username = useAuthStore((s) => s.session?.username);
  return useQuery({ queryKey: ["me", username], queryFn: getMe, enabled: !!username });
}

/** Decrypted custom avatar of the active user as an object URL, or null. */
export function useCustomAvatarUrl(): string | null {
  const { data: me } = useMe();
  const { data } = useQuery({
    queryKey: ["avatar", me?.username],
    queryFn: fetchCustomAvatarUrl,
    enabled: !!me?.has_custom_avatar,
    staleTime: Infinity,
  });
  return me?.has_custom_avatar ? (data ?? null) : null;
}
