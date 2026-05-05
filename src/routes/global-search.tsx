import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Container,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { NovelCard } from "../components/NovelCard";
import { SearchBar } from "../components/SearchBar";
import {
  globalSearch,
  type GlobalSearchResult,
} from "../lib/plugins/global-search";
import { importNovelFromSource } from "../lib/plugins/import-novel";
import { pluginManager } from "../lib/plugins/manager";
import type { NovelItem } from "../lib/plugins/types";
import { globalSearchRoute } from "../router";
import { useBrowseStore } from "../store/browse";

const PREVIEW_RESULT_COUNT = 6;

function resultKey(pluginId: string, novelPath: string): string {
  return `${pluginId}::${novelPath}`;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface SearchResultSectionProps {
  row: GlobalSearchResult;
  openingKey: string | null;
  onOpen: (row: GlobalSearchResult, novel: NovelItem) => void;
  onMore: (row: GlobalSearchResult) => void;
}

function SearchResultSection({
  row,
  openingKey,
  onOpen,
  onMore,
}: SearchResultSectionProps) {
  const previewNovels = row.novels.slice(0, PREVIEW_RESULT_COUNT);

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Group justify="space-between" wrap="nowrap" align="center">
          <Stack gap={2} style={{ minWidth: 0 }}>
            <Text size="sm" fw={600} truncate>
              {row.pluginName}
            </Text>
            {row.error ? (
              <Text size="xs" c="red">
                Failed
              </Text>
            ) : (
              <Text size="xs" c="dimmed">
                {row.novels.length} result
                {row.novels.length === 1 ? "" : "s"}
              </Text>
            )}
          </Stack>
          {!row.error && row.novels.length > 0 ? (
            <Button size="xs" variant="light" onClick={() => onMore(row)}>
              More
            </Button>
          ) : null}
        </Group>

        {row.error ? (
          <Alert color="red" variant="light">
            {row.error}
          </Alert>
        ) : previewNovels.length > 0 ? (
          <Group
            align="stretch"
            wrap="nowrap"
            gap="md"
            style={{ overflowX: "auto", paddingBottom: 4 }}
          >
            {previewNovels.map((novel, index) => {
              const key = resultKey(row.pluginId, novel.path);
              return (
                <Box
                  key={`${key}::${index}`}
                  style={{ flex: "0 0 140px", width: 140 }}
                >
                  <NovelCard
                    name={novel.name}
                    cover={novel.cover ?? null}
                    selected={openingKey === key}
                    onActivate={() => onOpen(row, novel)}
                  />
                </Box>
              );
            })}
          </Group>
        ) : (
          <Text size="sm" c="dimmed">
            No results from this source.
          </Text>
        )}
      </Stack>
    </Paper>
  );
}

export function GlobalSearchPage() {
  const { q } = globalSearchRoute.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pluginLanguageFilter = useBrowseStore((s) => s.pluginLanguageFilter);
  const globalSearchConcurrency = useBrowseStore(
    (s) => s.globalSearchConcurrency,
  );
  const setLastUsedPluginId = useBrowseStore((s) => s.setLastUsedPluginId);
  const [search, setSearch] = useState(q);
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setSearch(q);
  }, [q]);

  useEffect(() => {
    controllerRef.current?.abort();
    setOpenError(null);

    const trimmed = q.trim();
    if (trimmed === "") {
      setResults([]);
      setSearching(false);
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    setSearching(true);
    setResults([]);

    const searchablePlugins = pluginManager
      .list()
      .filter((plugin) => pluginLanguageFilter.includes(plugin.lang))
      .sort((a, b) => a.name.localeCompare(b.name));

    globalSearch(pluginManager, trimmed, {
      concurrency: globalSearchConcurrency,
      plugins: searchablePlugins,
      signal: controller.signal,
      onResult: (result) => {
        if (controller.signal.aborted) return;
        setResults((prev) => [...prev, result]);
      },
    })
      .catch(() => {
        // Per-plugin errors fold into GlobalSearchResult rows.
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setSearching(false);
        }
      });

    return () => controller.abort();
  }, [globalSearchConcurrency, pluginLanguageFilter, q]);

  const handleOpenNovel = useCallback(
    async (row: GlobalSearchResult, novel: NovelItem) => {
      if (openingKey !== null) return;

      const plugin = pluginManager.getPlugin(row.pluginId);
      if (!plugin) {
        setOpenError(`Plugin "${row.pluginName}" is no longer installed.`);
        return;
      }

      const key = resultKey(row.pluginId, novel.path);
      setLastUsedPluginId(row.pluginId);
      setOpeningKey(key);
      setOpenError(null);
      try {
        const id = await importNovelFromSource(plugin, novel);
        await queryClient.invalidateQueries({ queryKey: ["novel"] });
        await navigate({ to: "/novel", search: { id } });
      } catch (error) {
        setOpenError(`Failed to open "${novel.name}": ${describeError(error)}`);
      } finally {
        setOpeningKey((current) => (current === key ? null : current));
      }
    },
    [navigate, openingKey, queryClient, setLastUsedPluginId],
  );

  const submitSearch = () => {
    void navigate({
      to: "/search",
      search: { q: search.trim() },
    });
  };

  const openPluginResults = useCallback(
    (row: GlobalSearchResult) => {
      setLastUsedPluginId(row.pluginId);
      void navigate({
        to: "/source",
        search: { pluginId: row.pluginId, query: q.trim() },
      });
    },
    [navigate, q, setLastUsedPluginId],
  );

  const installedCount = pluginManager
    .list()
    .filter((plugin) => pluginLanguageFilter.includes(plugin.lang)).length;
  const hasSearchTerm = q.trim() !== "";
  const hasOnlyEmptyResults =
    hasSearchTerm &&
    results.length > 0 &&
    results.every((row) => row.novels.length === 0 && !row.error);

  return (
    <Container size="lg" py="xl">
      <Stack gap="md">
        <Group justify="space-between" align="baseline">
          <Title order={1}>Global search</Title>
          <Badge variant="light" color="grape">
            Sprint 2
          </Badge>
        </Group>

        <SearchBar
          value={search}
          onChange={setSearch}
          onSubmit={submitSearch}
          placeholder="Search across installed plugins..."
        />

        {installedCount === 0 ? (
          <Alert color="blue" title="No plugins installed">
            Install a plugin from the Browse tab, or enable one of its
            languages in Browse settings, to use global search.
          </Alert>
        ) : null}

        {searching ? (
          <Group gap="sm">
            <Loader size="sm" />
            <Text c="dimmed">
              Searching across {installedCount} plugin
              {installedCount === 1 ? "" : "s"}...
            </Text>
          </Group>
        ) : null}

        {openingKey !== null ? (
          <Group gap="sm">
            <Loader size="sm" />
            <Text c="dimmed">Opening novel details...</Text>
          </Group>
        ) : null}

        {openError ? (
          <Alert color="red" variant="light" title="Open failed">
            {openError}
          </Alert>
        ) : null}

        {!searching && hasOnlyEmptyResults ? (
          <Alert color="yellow" title="No matches">
            None of the installed plugins matched "{q}".
          </Alert>
        ) : null}

        <Stack gap="md">
          {results.map((row) => (
            <SearchResultSection
              key={row.pluginId}
              row={row}
              openingKey={openingKey}
              onOpen={(resultRow, novel) => {
                void handleOpenNovel(resultRow, novel);
              }}
              onMore={openPluginResults}
            />
          ))}
        </Stack>
      </Stack>
    </Container>
  );
}
