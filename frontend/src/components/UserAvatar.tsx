"use client";

import { Avatar } from "antd";

import { defaultAvatarUrl } from "@/lib/avatars";

interface UserAvatarProps {
  username: string;
  defaultAvatar?: string | null;
  /** Decrypted custom picture (object URL), takes precedence over the built-in icon. */
  customUrl?: string | null;
  size?: number;
}

export default function UserAvatar({ username, defaultAvatar, customUrl, size = 32 }: UserAvatarProps) {
  const src = customUrl ?? (defaultAvatar ? defaultAvatarUrl(defaultAvatar) : undefined);
  return (
    <Avatar size={size} src={src} alt={username}>
      {username.charAt(0).toUpperCase()}
    </Avatar>
  );
}
