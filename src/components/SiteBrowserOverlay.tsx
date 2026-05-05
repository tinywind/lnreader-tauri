import { useEffect, useRef } from "react";
import { ActionIcon, Box, Group, Text } from "@mantine/core";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "../i18n";
import { isTauriRuntime } from "../lib/tauri-runtime";
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
  await invoke("scraper_set_bounds", {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  });
}

async function navigate(url: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("scraper_navigate", { url });
}

async function hideScraper(): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("scraper_hide");
}

/**
 * Full-screen layered modal that hosts the persistent scraper
 * Webview as if it were embedded in the main window. The Webview
 * itself is a Tauri child of the main OS window. This component
 * just (a) reserves the rectangle the Webview should paint inside,
 * (b) tells Rust the rectangle's pixel bounds via
 * `scraper_set_bounds`, (c) renders the close-X chrome on top, and
 * (d) collapses the Webview back to its hidden 1x1 footprint when
 * the user closes the overlay.
 *
 * The Webview is never destroyed; its cookie jar survives every
 * open/close cycle so a manual login or CF clearance carries over
 * to the next plugin scrape.
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
      void hideScraper();
      return;
    }
    if (currentUrl && currentUrl !== lastNavigatedUrl.current) {
      lastNavigatedUrl.current = currentUrl;
      void navigate(currentUrl);
    }
  }, [visible, currentUrl]);

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
      });
    };

    sendBounds();
    const observer = new ResizeObserver(sendBounds);
    observer.observe(node);
    window.addEventListener("resize", sendBounds);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sendBounds);
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
