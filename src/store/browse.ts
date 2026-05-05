import { create } from "zustand";

interface BrowseState {
  /**
   * URL pending insertion via the Add Repository modal, set by
   * an `lnreader://repo/add?url=...` deep-link or other intent.
   * The Browse route consumes and clears it on render.
   */
  pendingRepoUrl: string | null;
  setPendingRepoUrl: (url: string | null) => void;
  clearPendingRepoUrl: () => void;
}

export const useBrowseStore = create<BrowseState>((set) => ({
  pendingRepoUrl: null,
  setPendingRepoUrl: (pendingRepoUrl) => set({ pendingRepoUrl }),
  clearPendingRepoUrl: () => set({ pendingRepoUrl: null }),
}));
