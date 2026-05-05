import { useState } from "react";
import { AppShell, Burger, Group, Title } from "@mantine/core";
import { Outlet } from "@tanstack/react-router";
import { CategoriesDrawer } from "../components/CategoriesDrawer";
import { SearchBar } from "../components/SearchBar";
import { useLibraryStore } from "../store/library";

export function RootLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const selectedCategoryId = useLibraryStore((s) => s.selectedCategoryId);
  const setSelectedCategoryId = useLibraryStore(
    (s) => s.setSelectedCategoryId,
  );
  const search = useLibraryStore((s) => s.search);
  const setSearch = useLibraryStore((s) => s.setSearch);

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
          <SearchBar value={search} onChange={setSearch} />
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
