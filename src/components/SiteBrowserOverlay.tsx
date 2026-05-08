import { useEffect, useRef } from "react";
import { Box, Group, Text } from "@mantine/core";
import { listen } from "@tauri-apps/api/event";
import { CloseGlyph } from "./ActionGlyphs";
import { IconButton } from "./IconButton";
import { useTranslation } from "../i18n";
import {
  getSiteBrowserPlatform,
  type SiteBrowserPlatformApi,
} from "../lib/site-browser";
import { isTauriRuntime } from "../lib/tauri-runtime";
import { useSiteBrowserStore } from "../store/site-browser";

const CHROME_HEIGHT = 40;
const BOUNDS_RESYNC_DELAYS_MS = [100, 500, 1000, 2000] as const;
const SCRAPER_CONTROL_POLL_INTERVAL_MS = 250;
const SITE_BROWSER_HIDDEN_EVENT = "site-browser-hidden";
const SITE_BROWSER_HIDDEN_DOM_EVENT = "norea-site-browser-hidden";

function reportScraperError(action: string, error: unknown): void {
  console.error(`[site-browser] ${action} failed`, error);
}

function debugSiteBrowser(message: string, data?: unknown): void {
  console.debug(`[site-browser] ${message}`, data);
}

function syncSiteBrowserBounds(
  platform: SiteBrowserPlatformApi,
  node: HTMLDivElement | null,
  url: string | null,
): Promise<void> {
  debugSiteBrowser("sync bounds requested", {
    platform: platform.name,
    hasNode: node !== null,
    url,
  });
  const bounds = platform.boundsFor(node);
  if (!bounds) return Promise.resolve();
  return platform.setBounds(bounds, url);
}

/**
 * Full-screen browser host for the persistent scraper Webview. Platform-
 * specific bounds, navigation, and chrome behavior are isolated behind
 * the site-browser platform API.
 *
 * The Webview is never destroyed; its cookie jar survives every
 * open/close cycle so a manual login or CF clearance carries over
 * to the next plugin scrape.
 *
 * Android uses a native WebView attached to the main Activity, but it
 * follows the same visible-overlay contract.
 */
export function SiteBrowserOverlay() {
  const { t } = useTranslation();
  const platform = getSiteBrowserPlatform();
  const visible = useSiteBrowserStore((s) => s.visible);
  const currentUrl = useSiteBrowserStore((s) => s.currentUrl);
  const openSequence = useSiteBrowserStore((s) => s.openSequence);
  const hide = useSiteBrowserStore((s) => s.hide);
  const inPageControls = platform.chromeMode === "in-page";

  const placeholderRef = useRef<HTMLDivElement | null>(null);
  const lastOpenSequence = useRef<number | null>(null);
  const nativeHiddenRef = useRef(false);
  const boundsResyncTimers = useRef<number[]>([]);

  const clearBoundsResyncTimers = () => {
    for (const timer of boundsResyncTimers.current) window.clearTimeout(timer);
    boundsResyncTimers.current = [];
  };

  const queueBoundsResync = () => {
    clearBoundsResyncTimers();
    debugSiteBrowser("queue bounds resync", {
      platform: platform.name,
      delays: BOUNDS_RESYNC_DELAYS_MS,
    });
    for (const delay of BOUNDS_RESYNC_DELAYS_MS) {
      const timer = window.setTimeout(() => {
        const node = placeholderRef.current;
        const state = useSiteBrowserStore.getState();
        if (!state.visible) return;
        void syncSiteBrowserBounds(platform, node, state.currentUrl).catch(
          (error) => reportScraperError("set bounds", error),
        );
      }, delay);
      boundsResyncTimers.current.push(timer);
    }
  };

  useEffect(() => {
    if (!visible) {
      clearBoundsResyncTimers();
      lastOpenSequence.current = null;
      if (nativeHiddenRef.current) {
        nativeHiddenRef.current = false;
        debugSiteBrowser("hide already handled by native", {
          platform: platform.name,
        });
        return;
      }
      debugSiteBrowser("hide requested", { platform: platform.name });
      void platform.hide().catch((error) => reportScraperError("hide", error));
      return;
    }
    nativeHiddenRef.current = false;
    if (currentUrl && openSequence !== lastOpenSequence.current) {
      debugSiteBrowser("open requested", {
        platform: platform.name,
        chromeMode: platform.chromeMode,
        currentUrl,
        openSequence,
        hasPlaceholder: placeholderRef.current !== null,
      });
      lastOpenSequence.current = openSequence;
      const node = placeholderRef.current;
      if (inPageControls || node) {
        void syncSiteBrowserBounds(platform, node, currentUrl).catch((error) =>
          reportScraperError("set bounds", error),
        );
        queueBoundsResync();
      }
      void (async () => {
        try {
          await platform.navigate(currentUrl);
          const nextNode = placeholderRef.current;
          debugSiteBrowser("navigate returned", {
            platform: platform.name,
            currentUrl,
            openSequence,
            hasPlaceholder: nextNode !== null,
          });
          if (inPageControls || nextNode) {
            await syncSiteBrowserBounds(platform, nextNode, currentUrl);
          }
          queueBoundsResync();
        } catch (error) {
          lastOpenSequence.current = null;
          reportScraperError("navigate", error);
        }
      })();
    }
  }, [currentUrl, inPageControls, openSequence, platform, visible]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const handleNativeHidden = () => {
      if (!useSiteBrowserStore.getState().visible) {
        nativeHiddenRef.current = false;
        return;
      }
      nativeHiddenRef.current = true;
      debugSiteBrowser("native hidden event received", {
        platform: platform.name,
      });
      useSiteBrowserStore.getState().hide();
    };
    window.addEventListener(SITE_BROWSER_HIDDEN_DOM_EVENT, handleNativeHidden);
    void listen(SITE_BROWSER_HIDDEN_EVENT, handleNativeHidden)
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;
      })
      .catch((error) => reportScraperError("listen hidden event", error));
    return () => {
      disposed = true;
      window.removeEventListener(
        SITE_BROWSER_HIDDEN_DOM_EVENT,
        handleNativeHidden,
      );
      unlisten?.();
    };
  }, [platform.name]);

  useEffect(() => {
    if (!visible || !inPageControls) return;
    let disposed = false;
    const poll = () => {
      void platform
        .pollControlMessage()
        .then((message) => {
          if (disposed || message?.action !== "close") return;
          useSiteBrowserStore.getState().hide();
        })
        .catch((error) => reportScraperError("poll controls", error));
    };
    poll();
    const timer = window.setInterval(poll, SCRAPER_CONTROL_POLL_INTERVAL_MS);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [currentUrl, inPageControls, platform, visible]);

  useEffect(() => {
    if (!visible) return;
    if (inPageControls) {
      const sendBounds = () => {
        void syncSiteBrowserBounds(platform, null, currentUrl).catch((error) =>
          reportScraperError("set bounds", error),
        );
        queueBoundsResync();
      };
      sendBounds();
      window.addEventListener("resize", sendBounds);
      window.visualViewport?.addEventListener("resize", sendBounds);
      return () => {
        window.removeEventListener("resize", sendBounds);
        window.visualViewport?.removeEventListener("resize", sendBounds);
      };
    }
    const node = placeholderRef.current;
    if (!node) return;

    const sendBounds = () => {
      void syncSiteBrowserBounds(platform, node, currentUrl).catch((error) =>
        reportScraperError("set bounds", error),
      );
    };

    sendBounds();
    const observer = new ResizeObserver(sendBounds);
    observer.observe(node);
    window.addEventListener("resize", sendBounds);
    window.visualViewport?.addEventListener("resize", sendBounds);
    window.visualViewport?.addEventListener("scroll", sendBounds);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sendBounds);
      window.visualViewport?.removeEventListener("resize", sendBounds);
      window.visualViewport?.removeEventListener("scroll", sendBounds);
    };
  }, [currentUrl, inPageControls, platform, visible]);

  if (!visible) return null;
  if (inPageControls) {
    debugSiteBrowser("react overlay skipped for in-page chrome", {
      platform: platform.name,
      currentUrl,
      openSequence,
    });
    return null;
  }

  return (
    <Box
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        backgroundColor: "var(--mantine-color-body)",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        paddingTop: "var(--lnr-safe-area-top)",
        paddingRight: "var(--lnr-safe-area-right)",
        paddingBottom: "var(--lnr-safe-area-bottom)",
        paddingLeft: "var(--lnr-safe-area-left)",
      }}
    >
      <Group
        h={CHROME_HEIGHT}
        px="md"
        justify="space-between"
        style={{
          borderBottom: "1px solid var(--mantine-color-default-border)",
          backgroundColor: "var(--mantine-color-body)",
          flexShrink: 0,
          position: "relative",
          zIndex: 1,
        }}
      >
        <Text size="sm" c="dimmed" lineClamp={1} style={{ flex: 1, minWidth: 0 }}>
          {currentUrl ?? ""}
        </Text>
        <IconButton label={t("siteBrowser.close")} size="lg" onClick={hide}>
          <CloseGlyph />
        </IconButton>
      </Group>
      <div ref={placeholderRef} style={{ flex: 1, minHeight: 0 }} />
    </Box>
  );
}
