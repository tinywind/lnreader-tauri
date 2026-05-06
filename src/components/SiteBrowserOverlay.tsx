import { useEffect, useRef } from "react";
import { Box, Group, Text } from "@mantine/core";
import { invoke } from "@tauri-apps/api/core";
import { CloseGlyph } from "./ActionGlyphs";
import { IconButton } from "./IconButton";
import { useTranslation } from "../i18n";
import {
  androidScraperHide,
  androidScraperNavigate,
  androidScraperSetBounds,
} from "../lib/android-scraper";
import { isAndroidRuntime, isTauriRuntime } from "../lib/tauri-runtime";
import { useSiteBrowserStore } from "../store/site-browser";

const CHROME_HEIGHT = 40;
const BOUNDS_RESYNC_DELAYS_MS = [100, 500, 1000, 2000] as const;
const SCRAPER_CONTROL_POLL_INTERVAL_MS = 250;

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ScraperControlMessage {
  action: string;
  sequence?: number | null;
}

async function pushBounds(rect: Bounds, url: string | null): Promise<void> {
  if (!isTauriRuntime()) return;
  if (isAndroidRuntime()) {
    androidScraperSetBounds(rect);
    return;
  }
  if (!url) return;
  await invoke("scraper_set_bounds", {
    url,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  });
}

async function navigate(url: string): Promise<void> {
  if (!isTauriRuntime()) return;
  if (isAndroidRuntime()) {
    await androidScraperNavigate(url);
    return;
  }
  await invoke("scraper_navigate", { url });
}

async function hideScraper(): Promise<void> {
  if (!isTauriRuntime()) return;
  if (isAndroidRuntime()) {
    androidScraperHide();
    return;
  }
  await invoke("scraper_hide");
}

function usesDesktopInPageControls(): boolean {
  return isTauriRuntime() && !isAndroidRuntime();
}

async function pollScraperControlMessage(): Promise<ScraperControlMessage | null> {
  if (!usesDesktopInPageControls()) return null;
  return await invoke<ScraperControlMessage | null>("scraper_poll_control_message");
}

function reportScraperError(action: string, error: unknown): void {
  console.error(`[site-browser] ${action} failed`, error);
}

function getDesktopSiteBrowserBounds(): Bounds {
  return {
    x: 0,
    y: 0,
    width: Math.max(1, window.innerWidth),
    height: Math.max(1, window.innerHeight),
  };
}

function getScraperBounds(node: HTMLDivElement): Bounds {
  if (isAndroidRuntime()) {
    const rect = node.getBoundingClientRect();
    return {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }

  return {
    x: 0,
    y: CHROME_HEIGHT,
    width: window.innerWidth,
    height: Math.max(1, window.innerHeight - CHROME_HEIGHT),
  };
}

function syncScraperBounds(
  node: HTMLDivElement | null,
  url: string | null,
): Promise<void> {
  if (usesDesktopInPageControls()) {
    return pushBounds(getDesktopSiteBrowserBounds(), url);
  }
  if (!node) return Promise.resolve();
  return pushBounds(getScraperBounds(node), url);
}

/**
 * Full-screen browser host for the persistent scraper Webview. On
 * desktop, controls are rendered inside the scraper WebView because
 * Linux WebKit surfaces can paint above React DOM chrome. On Android,
 * React still renders the top chrome above the native view.
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
  const visible = useSiteBrowserStore((s) => s.visible);
  const currentUrl = useSiteBrowserStore((s) => s.currentUrl);
  const hide = useSiteBrowserStore((s) => s.hide);
  const desktopInPageControls = usesDesktopInPageControls();

  const placeholderRef = useRef<HTMLDivElement | null>(null);
  const lastNavigatedUrl = useRef<string | null>(null);
  const boundsResyncTimers = useRef<number[]>([]);

  const clearBoundsResyncTimers = () => {
    for (const timer of boundsResyncTimers.current) window.clearTimeout(timer);
    boundsResyncTimers.current = [];
  };

  const queueBoundsResync = () => {
    clearBoundsResyncTimers();
    for (const delay of BOUNDS_RESYNC_DELAYS_MS) {
      const timer = window.setTimeout(() => {
        const node = placeholderRef.current;
        const state = useSiteBrowserStore.getState();
        if (!state.visible) return;
        void syncScraperBounds(node, state.currentUrl).catch((error) =>
          reportScraperError("set bounds", error),
        );
      }, delay);
      boundsResyncTimers.current.push(timer);
    }
  };

  useEffect(() => {
    if (!visible) {
      clearBoundsResyncTimers();
      lastNavigatedUrl.current = null;
      void hideScraper().catch((error) => reportScraperError("hide", error));
      return;
    }
    if (currentUrl && currentUrl !== lastNavigatedUrl.current) {
      lastNavigatedUrl.current = currentUrl;
      const node = placeholderRef.current;
      if (desktopInPageControls || node) {
        void syncScraperBounds(node, currentUrl).catch((error) =>
          reportScraperError("set bounds", error),
        );
      }
      void (async () => {
        try {
          await navigate(currentUrl);
          const nextNode = placeholderRef.current;
          if (desktopInPageControls || nextNode) {
            await syncScraperBounds(nextNode, currentUrl);
          }
          if (!desktopInPageControls) queueBoundsResync();
        } catch (error) {
          lastNavigatedUrl.current = null;
          reportScraperError("navigate", error);
        }
      })();
    }
  }, [currentUrl, desktopInPageControls, visible]);

  useEffect(() => {
    if (!visible || !desktopInPageControls) return;
    let disposed = false;
    const poll = () => {
      void pollScraperControlMessage()
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
  }, [currentUrl, desktopInPageControls, visible]);

  useEffect(() => {
    if (!visible) return;
    if (desktopInPageControls) {
      const sendBounds = () => {
        void syncScraperBounds(null, currentUrl).catch((error) =>
          reportScraperError("set bounds", error),
        );
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
      void syncScraperBounds(node, currentUrl).catch((error) =>
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
  }, [currentUrl, desktopInPageControls, visible]);

  if (!visible) return null;
  if (desktopInPageControls) return null;

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
