import { create } from "zustand";

/**
 * Session state. Lives ONLY in memory: no persist middleware, no localStorage/sessionStorage/cookies.
 * A page reload clears it and the user must enter the password again (intentional).
 */
interface AuthState {
  username: string | null;
  access: string | null;
  refresh: string | null;
  masterKey: CryptoKey | null;
  setSession: (session: { username: string; access: string; refresh: string; masterKey: CryptoKey }) => void;
  setAccess: (access: string) => void;
  logout: () => void;
}

const empty = { username: null, access: null, refresh: null, masterKey: null };

export const useAuthStore = create<AuthState>()((set) => ({
  ...empty,
  setSession: (session) => set(session),
  setAccess: (access) => set({ access }),
  logout: () => set(empty),
}));
