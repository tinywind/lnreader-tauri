import { useEffect } from "react";
import { Anchor, AppShell, Group, Title } from "@mantine/core";
import {
  Link,
  Outlet,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { SiteBrowserOverlay } from "../components/SiteBrowserOverlay";
import { startDeepLinkListener } from "../lib/deep-link";
import { useAppearanceStore } from "../store/appearance";
import { useBrowseStore } from "../store/browse";
import { useReaderStore } from "../store/reader";

const NAV_ITEMS = [
  { to: "/", label: "Library", compact: "Lib" },
  { to: "/browse", label: "Browse", compact: "Src" },
  { to: "/search", label: "Search", compact: "Find" },
  { to: "/reader", label: "Reader", compact: "Read" },
  { to: "/more", label: "More", compact: "More" },
] as const;

export function RootLayout() {
  const showHistoryTab = useAppearanceStore((s) => s.showHistoryTab);
  const showUpdatesTab = useAppearanceStore((s) => s.showUpdatesTab);
  const showLabelsInNav = useAppearanceStore((s) => s.showLabelsInNav);
  const fullScreenReader = useReaderStore((s) => s.general.fullScreen);
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const navigate = useNavigate();
  const hideHeader = fullScreenReader && pathname === "/reader";

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    startDeepLinkListener({
      onRepoAdd: (repoUrl) => {
        useBrowseStore.getState().setPendingRepoUrl(repoUrl);
        void navigate({ to: "/browse" });
      },
    })
      .then((cleanup) => {
        unlisten = cleanup;
      })
      .catch(() => {
        // Plugin not initialized (e.g. running outside Tauri host
        // for vite-only dev). Listener registration silently no-ops.
      });
    return () => {
      unlisten?.();
    };
  }, [navigate]);

  return (
    <AppShell header={{ height: hideHeader ? 0 : 56 }} padding={0}>
      <AppShell.Header
        style={{
          display: hideHeader ? "none" : undefined,
          background: "var(--lnr-surface)",
          color: "var(--lnr-on-surface)",
          borderColor: "var(--lnr-outline)",
        }}
      >
        <Group h="100%" px="md" gap="md" wrap="nowrap">
          <Title order={3} style={{ flexShrink: 0 }}>
            LNReaderTauri
          </Title>
          <Group gap="md" wrap="nowrap">
            {NAV_ITEMS.map((item) => (
              <Anchor
                key={item.to}
                component={Link}
                to={item.to}
                size="sm"
                underline="hover"
                fw={500}
                title={item.label}
                activeProps={{ style: { textDecoration: "underline" } }}
              >
                {showLabelsInNav ? item.label : item.compact}
              </Anchor>
            ))}
            {showUpdatesTab ? (
              <Anchor
                component={Link}
                to="/updates"
                size="sm"
                underline="hover"
                fw={500}
                title="Updates"
                activeProps={{ style: { textDecoration: "underline" } }}
              >
                {showLabelsInNav ? "Updates" : "Upd"}
              </Anchor>
            ) : null}
            {showHistoryTab ? (
              <Anchor
                component={Link}
                to="/history"
                size="sm"
                underline="hover"
                fw={500}
                title="History"
                activeProps={{ style: { textDecoration: "underline" } }}
              >
                {showLabelsInNav ? "History" : "Hist"}
              </Anchor>
            ) : null}
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Main
        style={{
          minHeight: "100vh",
          background: "var(--lnr-background)",
          color: "var(--lnr-on-background)",
        }}
      >
        <Outlet />
      </AppShell.Main>
      <SiteBrowserOverlay />
    </AppShell>
  );
}
