import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Container,
  Drawer,
  Group,
  Loader,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { NovelCard } from "../components/NovelCard";
import {
  PluginFilters,
  defaultFilterValues,
  type ResolvedFilterValues,
} from "../components/PluginFilters";
import { SearchBar } from "../components/SearchBar";
import { importNovelFromSource } from "../lib/plugins/import-novel";
import { pluginManager } from "../lib/plugins/manager";
import type { NovelItem } from "../lib/plugins/types";
import { sourceRoute } from "../router";
import { useSiteBrowserStore } from "../store/site-browser";

const SEARCH_DEBOUNCE_MS = 300;

type ListingMode = "popular" | "latest";

export function SourcePage() {
  const { pluginId } = sourceRoute.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const openSiteBrowser = useSiteBrowserStore((s) => s.openAt);

  const plugin = pluginManager.getPlugin(pluginId);

  const [mode, setMode] = useState<ListingMode>("popular");
  const [page, setPage] = useState(1);
  const [accumulated, setAccumulated] = useState<NovelItem[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebouncedValue(search, SEARCH_DEBOUNCE_MS);

  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const initialFilters = useMemo<ResolvedFilterValues>(
    () => (plugin?.filters ? defaultFilterValues(plugin.filters) : {}),
    [plugin],
  );
  const [pendingFilters, setPendingFilters] =
    useState<ResolvedFilterValues>(initialFilters);
  const [activeFilters, setActiveFilters] =
    useState<ResolvedFilterValues>(initialFilters);

  const trimmedSearch = debouncedSearch.trim();
  const isSearchMode = trimmedSearch.length > 0;

  // Reset accumulator when the inputs that define the listing change.
  const lastKey = useRef("");
  useEffect(() => {
    const key = `${mode}|${trimmedSearch}|${JSON.stringify(activeFilters)}|${pluginId}`;
    if (key !== lastKey.current) {
      lastKey.current = key;
      setPage(1);
      setAccumulated([]);
    }
  }, [mode, trimmedSearch, activeFilters, pluginId]);

  const listing = useQuery({
    enabled: !!plugin && pluginId.length > 0,
    queryKey: [
      "plugin",
      "source",
      pluginId,
      mode,
      trimmedSearch,
      activeFilters,
      page,
    ] as const,
    queryFn: async () => {
      if (!plugin) return [] as NovelItem[];
      if (isSearchMode) {
        return plugin.searchNovels(trimmedSearch, page);
      }
      return plugin.popularNovels(page, {
        showLatestNovels: mode === "latest",
        filters: activeFilters as never,
      });
    },
  });

  // Append the latest page once it lands.
  useEffect(() => {
    if (listing.data) {
      setAccumulated((prev) =>
        page === 1 ? listing.data : [...prev, ...listing.data],
      );
    }
  }, [listing.data, page]);

  const open = useMutation({
    mutationFn: async (item: NovelItem) => {
      if (!plugin) throw new Error("plugin not loaded");
      return importNovelFromSource(plugin, item);
    },
    onSuccess: (novelId) => {
      void queryClient.invalidateQueries({ queryKey: ["novel"] });
      void navigate({ to: "/novel", search: { id: novelId } });
    },
  });

  if (!plugin) {
    return (
      <Container size="lg" py="xl">
        <Alert color="orange" title="Plugin not loaded">
          No plugin matches id <code>{pluginId}</code>. Install it from
          the Browse tab and try again.
        </Alert>
      </Container>
    );
  }

  const filterCount = plugin.filters
    ? Object.keys(plugin.filters).length
    : 0;
  const hasNextPage =
    !listing.isFetching && !!listing.data && listing.data.length > 0;

  return (
    <Container size="lg" py="xl">
      <Stack gap="md">
        <Group justify="space-between" align="baseline" wrap="nowrap">
          <Stack gap={2} style={{ minWidth: 0 }}>
            <Title order={2}>{plugin.name}</Title>
            <Anchor
              size="xs"
              c="dimmed"
              onClick={(event) => {
                event.preventDefault();
                openSiteBrowser(plugin.site);
              }}
            >
              {plugin.site}
            </Anchor>
          </Stack>
          <Group gap="xs">
            <Badge variant="light">{plugin.lang}</Badge>
            <Badge variant="light" color="gray">
              v{plugin.version}
            </Badge>
          </Group>
        </Group>

        <Group justify="space-between" wrap="nowrap" gap="md">
          <SegmentedControl
            value={mode}
            onChange={(value) => setMode(value as ListingMode)}
            data={[
              { value: "popular", label: "Popular" },
              { value: "latest", label: "Latest" },
            ]}
            disabled={isSearchMode}
          />
          {filterCount > 0 && (
            <Button
              variant="light"
              size="xs"
              onClick={() => {
                setPendingFilters(activeFilters);
                setFilterDrawerOpen(true);
              }}
              disabled={isSearchMode}
            >
              Filters ({filterCount})
            </Button>
          )}
        </Group>

        <SearchBar value={search} onChange={setSearch} />

        {listing.isLoading && page === 1 ? (
          <Group gap="sm">
            <Loader size="sm" />
            <Text c="dimmed">
              {isSearchMode
                ? `Searching ${plugin.name} for "${trimmedSearch}"…`
                : `Loading ${mode}…`}
            </Text>
          </Group>
        ) : listing.error ? (
          <Alert color="red" title="Source error">
            {listing.error instanceof Error
              ? listing.error.message
              : String(listing.error)}
          </Alert>
        ) : accumulated.length === 0 ? (
          <Alert color="blue" variant="light" title="No results">
            {isSearchMode
              ? `${plugin.name} returned no matches for "${trimmedSearch}".`
              : `${plugin.name} returned no novels for ${mode}.`}
          </Alert>
        ) : (
          <Stack gap="md">
            <SimpleGrid
              cols={{ base: 2, xs: 3, sm: 4, md: 5, lg: 6 }}
              spacing="md"
              verticalSpacing="lg"
            >
              {accumulated.map((item) => (
                <NovelCard
                  key={`${item.path}`}
                  name={item.name}
                  cover={item.cover ?? null}
                  onActivate={() => {
                    if (!open.isPending) open.mutate(item);
                  }}
                />
              ))}
            </SimpleGrid>
            <Group justify="center">
              <Button
                variant="default"
                onClick={() => setPage((p) => p + 1)}
                loading={listing.isFetching}
                disabled={!hasNextPage}
              >
                Load more
              </Button>
            </Group>
          </Stack>
        )}
      </Stack>

      {plugin.filters && (
        <Drawer
          opened={filterDrawerOpen}
          onClose={() => setFilterDrawerOpen(false)}
          title={`${plugin.name} filters`}
          position="right"
          size="md"
        >
          <Stack gap="md">
            <PluginFilters
              schema={plugin.filters}
              values={pendingFilters}
              onChange={setPendingFilters}
            />
            <Group justify="space-between">
              <Button
                variant="subtle"
                onClick={() => {
                  setPendingFilters(initialFilters);
                }}
              >
                Reset
              </Button>
              <Group gap="xs">
                <Button
                  variant="default"
                  onClick={() => setFilterDrawerOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    setActiveFilters(pendingFilters);
                    setFilterDrawerOpen(false);
                  }}
                >
                  Apply
                </Button>
              </Group>
            </Group>
          </Stack>
        </Drawer>
      )}
    </Container>
  );
}
