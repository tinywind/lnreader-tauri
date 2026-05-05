import { create } from "zustand";

interface SiteBrowserState {
  /** Whether the in-app site browser overlay is currently shown. */
  visible: boolean;
  /** The URL the scraper Webview should be navigated to on open. */
  currentUrl: string | null;
  /** Open the overlay at `url` (caller-driven navigation). */
  openAt: (url: string) => void;
  /** Hide the overlay. The scraper Webview is collapsed but kept alive. */
  hide: () => void;
}

export const useSiteBrowserStore = create<SiteBrowserState>((set) => ({
  visible: false,
  currentUrl: null,
  openAt: (url) => set({ visible: true, currentUrl: url }),
  hide: () => set({ visible: false }),
}));
