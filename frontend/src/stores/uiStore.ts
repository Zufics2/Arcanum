import { create } from "zustand";

interface UiState {
  /** "Server's eyes" mode: show the drive exactly as the server stores it (ciphertext). */
  serverView: boolean;
  setServerView: (on: boolean) => void;
}

export const useUiStore = create<UiState>()((set) => ({
  serverView: false,
  setServerView: (serverView) => set({ serverView }),
}));
