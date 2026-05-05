import { useState } from "react";
import { AppShell, Burger, Group, Title } from "@mantine/core";
import { Outlet } from "@tanstack/react-router";
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
        <Group h="100%" px="md" gap="md">
          <Burger
            opened={drawerOpen}
            onClick={() => setDrawerOpen((open) => !open)}
            size="sm"
            aria-label="Toggle categories drawer"
          />
          <Title order={3}>LNReaderTauri</Title>
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
