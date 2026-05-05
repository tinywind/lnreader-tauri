import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Anchor,
  Badge,
  Box,
  Button,
  Drawer,
  Group,
  Loader,
  SegmentedControl,
  Stack,
  Text,
} from "@mantine/core";
import { PageFrame, PageHeader, StateView } from "../components/AppFrame";
import {
  ConsoleChip,
  ConsoleCover,
  ConsolePanel,
  ConsoleSectionHeader,
  ConsoleStatusDot,
  ConsoleStatusStrip,
} from "../components/ConsolePrimitives";
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
import "../styles/browse.css";

type ListingMode = "popular" | "latest";

function countActiveFilters(filters: ResolvedFilterValues): number {
  return Object.values(filters).filter((entry) => {
    const value = entry.value;
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === "object") {
      const choices = value as { exclude?: unknown[]; include?: unknown[] };
      return (
        (choices.include?.length ?? 0) > 0 ||
        (choices.exclude?.length ?? 0) > 0
      );
    }
    return value !== null && value !== undefined && value !== "" && value !== false;
  }).length;
}

interface SourceNovelButtonProps {
  disabled: boolean;
  item: NovelItem;
  onOpen: (item: NovelItem) => void;
}

function SourceNovelButton({
  disabled,
  item,
  onOpen,
}: SourceNovelButtonProps) {
  return (
    <button
      type="button"
      className="lnr-source-card"
      disabled={disabled}
      onClick={() => onOpen(item)}
    >
      <ConsoleCover
        alt={item.name}
        src={item.cover ?? null}
        width={104}
        height={152}
      />
      <span className="lnr-source-card-title" title={item.name}>
        {item.name}
      </span>
      <span className="lnr-source-card-path" title={item.path}>
        {item.path}
      </span>
    </button>
  );
}

export function SourcePage() {
  const { pluginId, query } = sourceRoute.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const openSiteBrowser = useSiteBrowserStore((s) => s.openAt);

  const plugin = pluginManager.getPlugin(pluginId);

  const [mode, setMode] = useState<ListingMode>("popular");
  const [page, setPage] = useState(1);
  const [accumulated, setAccumulated] = useState<NovelItem[]>([]);
  const [search, setSearch] = useState(query);
  const [submittedSearch, setSubmittedSearch] = useState(query);

  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const initialFilters = useMemo<ResolvedFilterValues>(
    () => (plugin?.filters ? defaultFilterValues(plugin.filters) : {}),
    [plugin],
  );
  const [pendingFilters, setPendingFilters] =
    useState<ResolvedFilterValues>(initialFilters);
  const [activeFilters, setActiveFilters] =
    useState<ResolvedFilterValues>(initialFilters);

  useEffect(() => {
    setSearch(query);
    setSubmittedSearch(query);
  }, [query]);

  const trimmedSearch = submittedSearch.trim();
  const isSearchMode = trimmedSearch.length > 0;

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
      <PageFrame>
        <StateView
          color="orange"
          title="Plugin not loaded"
          message={
            <>
              No plugin matches id <code>{pluginId}</code>. Install it from
              the Browse tab and try again.
            </>
          }
        />
      </PageFrame>
    );
  }

  const filterCount = plugin.filters
    ? Object.keys(plugin.filters).length
    : 0;
  const activeFilterCount = countActiveFilters(activeFilters);
  const hasNextPage =
    !listing.isFetching && !!listing.data && listing.data.length > 0;
  const sourceStatus: "active" | "done" | "error" = listing.error
    ? "error"
    : listing.isFetching
      ? "active"
      : "done";

  return (
    <PageFrame size="wide" className="lnr-source-page">
      <PageHeader
        title={plugin.name}
        description={
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
        }
        actions={
          <>
            <Badge variant="light">{plugin.lang}</Badge>
            <Badge variant="light" color="gray">
              v{plugin.version}
            </Badge>
          </>
        }
      />

      <div className="lnr-source-workbench">
        <aside className="lnr-source-tools">
          <ConsolePanel title="Source controls">
            <Stack gap="sm" p="sm">
              <SegmentedControl
                value={mode}
                onChange={(value) => setMode(value as ListingMode)}
                data={[
                  { value: "popular", label: "Popular" },
                  { value: "latest", label: "Latest" },
                ]}
                disabled={isSearchMode}
                size="xs"
                className="lnr-console-segmented"
              />

              <SearchBar
                value={search}
                onChange={setSearch}
                onSubmit={() => setSubmittedSearch(search)}
                placeholder={`Search ${plugin.name}...`}
              />

              <Group gap="xs" wrap="wrap">
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
                    Filters ({activeFilterCount}/{filterCount})
                  </Button>
                )}
                <Button
                  variant="default"
                  size="xs"
                  onClick={() => openSiteBrowser(plugin.site)}
                >
                  Open WebView
                </Button>
              </Group>
            </Stack>
          </ConsolePanel>

          <ConsolePanel title="Source state">
            <Stack gap="sm" p="sm">
              <Group gap={6} wrap="wrap">
                <ConsoleStatusDot
                  status={sourceStatus}
                  label={
                    listing.error
                      ? "Source error"
                      : listing.isFetching
                        ? "Fetching"
                        : "Ready"
                  }
                />
                <ConsoleChip>{plugin.lang.toUpperCase()}</ConsoleChip>
                <ConsoleChip>v{plugin.version}</ConsoleChip>
                {isSearchMode ? (
                  <ConsoleChip active>Search mode</ConsoleChip>
                ) : (
                  <ConsoleChip active>{mode}</ConsoleChip>
                )}
              </Group>
              <Box style={{ minWidth: 0 }}>
                <Text className="lnr-console-kicker">Prepared origin</Text>
                <Anchor
                  size="sm"
                  truncate
                  onClick={(event) => {
                    event.preventDefault();
                    openSiteBrowser(plugin.site);
                  }}
                >
                  {plugin.site}
                </Anchor>
              </Box>
            </Stack>
          </ConsolePanel>
        </aside>

        <section className="lnr-source-results-panel">
          <ConsoleSectionHeader
            eyebrow={isSearchMode ? "Source search" : "Source catalog"}
            title={isSearchMode ? `"${trimmedSearch}"` : mode}
            count={`${accumulated.length} loaded`}
            actions={
              <Button
                variant="default"
                size="xs"
                onClick={() => setPage((p) => p + 1)}
                loading={listing.isFetching && page > 1}
                disabled={!hasNextPage}
              >
                Load more
              </Button>
            }
          />

          {listing.isLoading && page === 1 ? (
            <StateView
              title={
                <Group gap="sm">
                  <Loader size="sm" />
                  {isSearchMode
                    ? `Searching ${plugin.name} for "${trimmedSearch}"...`
                    : `Loading ${mode}...`}
                </Group>
              }
            />
          ) : listing.error ? (
            <StateView
              color="red"
              title="Source error"
              message={
                listing.error instanceof Error
                  ? listing.error.message
                  : String(listing.error)
              }
            />
          ) : accumulated.length === 0 ? (
            <StateView
              color="blue"
              title="No results"
              message={
                isSearchMode
                  ? `${plugin.name} returned no matches for "${trimmedSearch}".`
                  : `${plugin.name} returned no novels for ${mode}.`
              }
            />
          ) : (
            <div className="lnr-source-grid">
              {accumulated.map((item) => (
                <SourceNovelButton
                  key={item.path}
                  item={item}
                  disabled={open.isPending}
                  onOpen={(novel) => {
                    if (!open.isPending) open.mutate(novel);
                  }}
                />
              ))}
            </div>
          )}

          {open.error ? (
            <StateView
              color="red"
              title="Open failed"
              message={
                open.error instanceof Error
                  ? open.error.message
                  : String(open.error)
              }
            />
          ) : null}
        </section>
      </div>

      <ConsoleStatusStrip>
        <span>{plugin.name}</span>
        <span>{isSearchMode ? `search: ${trimmedSearch}` : `mode: ${mode}`}</span>
        <span>page {page}</span>
        <span>{accumulated.length} novels loaded</span>
        <span>{activeFilterCount} active filters</span>
      </ConsoleStatusStrip>

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
    </PageFrame>
  );
}
