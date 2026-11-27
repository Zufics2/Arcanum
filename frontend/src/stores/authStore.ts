import { create } from "zustand";

/**
 * Session state. Tokens and keys live ONLY in memory: no persist middleware,
 * no localStorage/sessionStorage. A page reload drops every key.
 *
 * What survives a reload is the httpOnly session cookie (set by the server, unreadable by JS):
 * it tells us who was logged in, so we can show the unlock screen instead of the full login form.
 */
export interface Session {
  username: string;
  access: string;
  refresh: string;
  masterKey: CryptoKey;
  defaultAvatar: string;
}

/** A user whose session cookie is valid, but whose keys are gone (page was reloaded). */
export interface LockedUser {
  username: string;
  defaultAvatar: string;
}

interface AuthState {
  /** The active, unlocked account. */
  session: Session | null;
  /** Other accounts unlocked in this tab (account switching). */
  others: Session[];
  locked: LockedUser | null;
  /** True until the initial session-cookie check finishes. */
  restoring: boolean;
  /** Where to go after login/unlock (the page the user was on). */
  returnTo: string | null;

  addSession: (session: Session) => void;
  setAccess: (access: string) => void;
  switchTo: (username: string) => void;
  /** Ends the active session; the next unlocked account (if any) becomes active. */
  endActive: () => void;
  dropOther: (username: string) => void;
  setLocked: (locked: LockedUser | null) => void;
  setRestoring: (restoring: boolean) => void;
  setReturnTo: (path: string | null) => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
  session: null,
  others: [],
  locked: null,
  restoring: true,
  returnTo: null,

  addSession: (session) =>
    set((s) => ({
      session,
      others: [...(s.session ? [s.session] : []), ...s.others].filter((o) => o.username !== session.username),
      locked: null,
    })),

  setAccess: (access) => set((s) => (s.session ? { session: { ...s.session, access } } : {})),

  switchTo: (username) =>
    set((s) => {
      const target = s.others.find((o) => o.username === username);
      if (!target) return {};
      return {
        session: target,
        others: [...(s.session ? [s.session] : []), ...s.others.filter((o) => o.username !== username)],
      };
    }),

  endActive: () => set((s) => ({ session: s.others[0] ?? null, others: s.others.slice(1) })),

  dropOther: (username) => set((s) => ({ others: s.others.filter((o) => o.username !== username) })),

  setLocked: (locked) => set({ locked }),
  setRestoring: (restoring) => set({ restoring }),
  setReturnTo: (returnTo) => set({ returnTo }),
}));

/** Convenience for non-React code. */
export function activeSession(): Session | null {
  return useAuthStore.getState().session;
}
