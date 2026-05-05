import { useEffect, useState } from "react";
import { Anchor, AppShell, Burger, Group, Title } from "@mantine/core";
import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { CategoriesDrawer } from "../components/CategoriesDrawer";
import { startDeepLinkListener } from "../lib/deep-link";
import { useBrowseStore } from "../store/browse";
import { useLibraryStore } from "../store/library";

export function RootLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const selectedCategoryId = useLibraryStore((s) => s.selectedCategoryId);
  const setSelectedCategoryId = useLibraryStore(
    (s) => s.setSelectedCategoryId,
  );
  const navigate = useNavigate();

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
    <AppShell header={{ height: 56 }} padding={0}>
      <AppShell.Header>
        <Group h="100%" px="md" gap="md" wrap="nowrap">
          <Burger
            opened={drawerOpen}
            onClick={() => setDrawerOpen((open) => !open)}
            size="sm"
            aria-label="Toggle categories drawer"
          />
          <Title order={3} style={{ flexShrink: 0 }}>
            LNReaderTauri
          </Title>
          <Group gap="md" wrap="nowrap">
            <Anchor
              component={Link}
              to="/"
              size="sm"
              underline="hover"
              fw={500}
              activeProps={{ style: { textDecoration: "underline" } }}
            >
              Library
            </Anchor>
            <Anchor
              component={Link}
              to="/browse"
              size="sm"
              underline="hover"
              fw={500}
              activeProps={{ style: { textDecoration: "underline" } }}
            >
              Browse
            </Anchor>
            <Anchor
              component={Link}
              to="/search"
              size="sm"
              underline="hover"
              fw={500}
              activeProps={{ style: { textDecoration: "underline" } }}
            >
              Search
            </Anchor>
            <Anchor
              component={Link}
              to="/reader"
              size="sm"
              underline="hover"
              fw={500}
              activeProps={{ style: { textDecoration: "underline" } }}
            >
              Reader
            </Anchor>
            <Anchor
              component={Link}
              to="/more"
              size="sm"
              underline="hover"
              fw={500}
              activeProps={{ style: { textDecoration: "underline" } }}
            >
              More
            </Anchor>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
      <CategoriesDrawer
        opened={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        selectedCategoryId={selectedCategoryId}
        onSelect={setSelectedCategoryId}
      />
    </AppShell>
  );
}
