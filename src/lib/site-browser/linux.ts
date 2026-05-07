import { invoke } from "@tauri-apps/api/core";
import type {
  SiteBrowserBounds,
  SiteBrowserControlMessage,
  SiteBrowserPlatformApi,
} from "./types";

function fullWindowBounds(): SiteBrowserBounds {
  return {
    x: 0,
    y: 0,
    width: Math.max(1, window.innerWidth),
    height: Math.max(1, window.innerHeight),
  };
}

export const linuxSiteBrowser: SiteBrowserPlatformApi = {
  name: "linux",
  chromeMode: "in-page",
  boundsFor: () => fullWindowBounds(),
  setBounds: async (bounds, url) => {
    if (!url) return;
    await invoke("scraper_set_bounds", {
      url,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    });
  },
  navigate: async (url) => {
    await invoke("scraper_navigate", { url });
  },
  hide: async () => {
    await invoke("scraper_hide");
  },
  pollControlMessage: async () =>
    await invoke<SiteBrowserControlMessage | null>(
      "scraper_poll_control_message",
    ),
};
