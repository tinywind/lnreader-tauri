import { useState } from "react";
import { Anchor, AppShell, Burger, Group, Title } from "@mantine/core";
import { Link, Outlet } from "@tanstack/react-router";
import { CategoriesDrawer } from "../components/CategoriesDrawer";
import { useLibraryStore } from "../store/library";

export function RootLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const selectedCategoryId = useLibraryStore((s) => s.selectedCategoryId);
  const setSelectedCategoryId = useLibraryStore(
    (s) => s.setSelectedCategoryId,
  );

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
