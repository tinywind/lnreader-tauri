import { invoke } from "@tauri-apps/api/core";
import type {
  SiteBrowserBounds,
  SiteBrowserControlMessage,
  SiteBrowserPlatformApi,
} from "./types";

function debugLinuxSiteBrowser(message: string, data?: unknown): void {
  console.info(`[site-browser:linux] ${message}`, data);
}

function fullWindowBounds(): SiteBrowserBounds {
  const bounds = {
    x: 0,
    y: 0,
    width: Math.max(1, window.innerWidth),
    height: Math.max(1, window.innerHeight),
  };
  debugLinuxSiteBrowser("bounds measured from window", {
    bounds,
    viewport: {
      height: window.innerHeight,
      outerHeight: window.outerHeight,
      outerWidth: window.outerWidth,
      visualHeight: window.visualViewport?.height ?? null,
      visualWidth: window.visualViewport?.width ?? null,
      width: window.innerWidth,
    },
  });
  return bounds;
}

export const linuxSiteBrowser: SiteBrowserPlatformApi = {
  name: "linux",
  chromeMode: "in-page",
  boundsFor: () => fullWindowBounds(),
  setBounds: async (bounds, url) => {
    if (!url) {
      debugLinuxSiteBrowser("setBounds skipped: url is empty", { bounds });
      return;
    }
    const args = {
      url,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    };
    debugLinuxSiteBrowser("setBounds invoke", args);
    await invoke("scraper_set_bounds", args);
    debugLinuxSiteBrowser("setBounds complete", args);
  },
  navigate: async (url) => {
    debugLinuxSiteBrowser("navigate invoke", { url });
    await invoke("scraper_navigate", { url });
    debugLinuxSiteBrowser("navigate complete", { url });
  },
  hide: async () => {
    debugLinuxSiteBrowser("hide invoke");
    await invoke("scraper_hide");
    debugLinuxSiteBrowser("hide complete");
  },
  pollControlMessage: async () =>
    await invoke<SiteBrowserControlMessage | null>(
      "scraper_poll_control_message",
    ),
};
