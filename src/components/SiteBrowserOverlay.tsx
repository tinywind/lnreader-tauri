import { useEffect, useRef } from "react";
import { ActionIcon, Box, Group, Text } from "@mantine/core";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "../i18n";
import {
  androidScraperHide,
  androidScraperNavigate,
  androidScraperSetBounds,
} from "../lib/android-scraper";
import { isAndroidRuntime, isTauriRuntime } from "../lib/tauri-runtime";
import { useSiteBrowserStore } from "../store/site-browser";

const CHROME_HEIGHT = 40;

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function pushBounds(rect: Bounds): Promise<void> {
  if (!isTauriRuntime()) return;
  if (isAndroidRuntime()) {
    androidScraperSetBounds(rect);
    return;
  }
  await invoke("scraper_set_bounds", {
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

function reportScraperError(action: string, error: unknown): void {
  console.error(`[site-browser] ${action} failed`, error);
}

/**
 * Full-screen layered modal that hosts the persistent scraper
 * Webview as if it were embedded in the main window. The Webview is
 * a sibling native surface: a Tauri child Webview on desktop and a
 * native Android WebView attached to MainActivity on Android. This
 * component reserves the rectangle it should paint inside, renders
 * the close-X chrome on top, and collapses the Webview back to its
 * hidden 1x1 footprint when the user closes the overlay.
 *
 * The Webview is never destroyed; its cookie jar survives every
 * open/close cycle so a manual login or CF clearance carries over
 * to the next plugin scrape.
 *
 * Android uses a native WebView attached to the main Activity, but it
 * follows the same visible-overlay contract as desktop.
 */
export function SiteBrowserOverlay() {
  const { t } = useTranslation();
  const visible = useSiteBrowserStore((s) => s.visible);
  const currentUrl = useSiteBrowserStore((s) => s.currentUrl);
  const hide = useSiteBrowserStore((s) => s.hide);

  const placeholderRef = useRef<HTMLDivElement | null>(null);
  const lastNavigatedUrl = useRef<string | null>(null);

  useEffect(() => {
    if (!visible) {
      lastNavigatedUrl.current = null;
      void hideScraper().catch((error) => reportScraperError("hide", error));
      return;
    }
    if (currentUrl && currentUrl !== lastNavigatedUrl.current) {
      lastNavigatedUrl.current = currentUrl;
      const node = placeholderRef.current;
      if (node) {
        const rect = node.getBoundingClientRect();
        void pushBounds({
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        }).catch((error) => reportScraperError("set bounds", error));
      }
      void navigate(currentUrl).catch((error) => {
        lastNavigatedUrl.current = null;
        reportScraperError("navigate", error);
      });
    }
  }, [currentUrl, visible]);

  useEffect(() => {
    if (!visible) return;
    const node = placeholderRef.current;
    if (!node) return;

    const sendBounds = () => {
      const rect = node.getBoundingClientRect();
      void pushBounds({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      }).catch((error) => reportScraperError("set bounds", error));
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
  }, [visible]);

  if (!visible) return null;

  return (
    <Box
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        backgroundColor: "var(--mantine-color-body)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Group
        h={CHROME_HEIGHT}
        px="md"
        justify="space-between"
        style={{
          borderBottom: "1px solid var(--mantine-color-default-border)",
          flexShrink: 0,
        }}
      >
        <Text size="sm" c="dimmed" lineClamp={1} style={{ flex: 1, minWidth: 0 }}>
          {currentUrl ?? ""}
        </Text>
        <ActionIcon
          variant="subtle"
          size="lg"
          aria-label={t("siteBrowser.close")}
          onClick={hide}
        >
          X
        </ActionIcon>
      </Group>
      <div ref={placeholderRef} style={{ flex: 1, minHeight: 0 }} />
    </Box>
  );
}
