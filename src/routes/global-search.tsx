import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Container,
  Group,
  Loader,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
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

const SEARCH_DEBOUNCE_MS = 300;

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
}

function SearchResultSection({
  row,
  openingKey,
  onOpen,
}: SearchResultSectionProps) {
  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Group justify="space-between" wrap="nowrap" align="baseline">
          <Text size="sm" fw={600}>
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
        </Group>

        {row.error ? (
          <Alert color="red" variant="light">
            {row.error}
          </Alert>
        ) : row.novels.length > 0 ? (
          <SimpleGrid
            cols={{ base: 2, xs: 3, sm: 4, md: 5, lg: 6 }}
            spacing="md"
            verticalSpacing="lg"
          >
            {row.novels.map((novel, index) => {
              const key = resultKey(row.pluginId, novel.path);
              return (
                <NovelCard
                  key={`${key}::${index}`}
                  name={novel.name}
                  cover={novel.cover ?? null}
                  selected={openingKey === key}
                  onActivate={() => onOpen(row, novel)}
                />
              );
            })}
          </SimpleGrid>
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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebouncedValue(search, SEARCH_DEBOUNCE_MS);
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    controllerRef.current?.abort();
    setOpenError(null);

    const trimmed = debouncedSearch.trim();
    if (trimmed === "") {
      setResults([]);
      setSearching(false);
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    setSearching(true);
    setResults([]);

    globalSearch(pluginManager, trimmed, {
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
  }, [debouncedSearch]);

  const handleOpenNovel = useCallback(
    async (row: GlobalSearchResult, novel: NovelItem) => {
      if (openingKey !== null) return;

      const plugin = pluginManager.getPlugin(row.pluginId);
      if (!plugin) {
        setOpenError(`Plugin "${row.pluginName}" is no longer installed.`);
        return;
      }

      const key = resultKey(row.pluginId, novel.path);
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
    [navigate, openingKey, queryClient],
  );

  const installedCount = pluginManager.size();
  const hasSearchTerm = debouncedSearch.trim() !== "";
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

        <SearchBar value={search} onChange={setSearch} />

        {installedCount === 0 ? (
          <Alert color="blue" title="No plugins installed">
            Install a plugin from the Browse tab to enable global search.
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
            None of the installed plugins matched "{debouncedSearch}".
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
            />
          ))}
        </Stack>
      </Stack>
    </Container>
  );
}
