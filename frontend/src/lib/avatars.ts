/** Built-in profile icons in public/avatars. Keep in sync with backend/accounts/avatars.py. */
export const DEFAULT_AVATARS = [
  "lock-indigo",
  "lock-red",
  "lock-orange",
  "lock-yellow",
  "lock-green",
  "lock-cyan",
  "lock-purple",
  "lock-pink",
  "lock-white",
] as const;

export function defaultAvatarUrl(name: string): string {
  return `/avatars/${name}.jpg`;
}
