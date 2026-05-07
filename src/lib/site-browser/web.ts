import type { SiteBrowserPlatformApi } from "./types";

export const webSiteBrowser: SiteBrowserPlatformApi = {
  name: "web",
  chromeMode: "react",
  boundsFor: () => null,
  setBounds: async () => {},
  navigate: async () => {},
  hide: async () => {},
  pollControlMessage: async () => null,
};
