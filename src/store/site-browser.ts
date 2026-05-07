import { create } from "zustand";

interface SiteBrowserState {
  /** Whether the in-app site browser overlay is currently shown. */
  visible: boolean;
  /** The URL the scraper Webview should be navigated to on open. */
  currentUrl: string | null;
  /** Monotonic sequence for repeated open requests, including the same URL. */
  openSequence: number;
  /** Open the overlay at `url` (caller-driven navigation). */
  openAt: (url: string) => void;
  /** Hide the overlay. The scraper Webview is collapsed but kept alive. */
  hide: () => void;
}

export const useSiteBrowserStore = create<SiteBrowserState>((set) => ({
  visible: false,
  currentUrl: null,
  openSequence: 0,
  openAt: (url) =>
    set((state) => ({
      visible: true,
      currentUrl: url,
      openSequence: state.openSequence + 1,
    })),
  hide: () => set({ visible: false }),
}));
