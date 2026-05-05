import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Container,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { SearchBar } from "../components/SearchBar";
import {
  globalSearch,
  type GlobalSearchResult,
} from "../lib/plugins/global-search";
import { pluginManager } from "../lib/plugins/manager";

const SEARCH_DEBOUNCE_MS = 300;

export function GlobalSearchPage() {
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebouncedValue(search, SEARCH_DEBOUNCE_MS);
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Cancel any in-flight search before starting a new one. Per
    // prd.md §8 Sprint 2 acceptance, this needs to fire within
    // 100 ms of the user typing a new query — useDebouncedValue
    // gives us 300 ms of input quiescence, then a single abort +
    // restart.
    controllerRef.current?.abort();

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
        // Per-plugin errors fold into the GlobalSearchResult row;
        // an outer rejection is fatal and we just stop showing the
        // spinner.
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setSearching(false);
        }
      });

    return () => controller.abort();
  }, [debouncedSearch]);

  const installedCount = pluginManager.size();

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
              {installedCount === 1 ? "" : "s"}…
            </Text>
          </Group>
        ) : null}

        {!searching &&
        debouncedSearch.trim() !== "" &&
        results.length > 0 &&
        results.every((row) => row.novels.length === 0 && !row.error) ? (
          <Alert color="yellow" title="No matches">
            None of the installed plugins matched “{debouncedSearch}”.
          </Alert>
        ) : null}

        <Stack gap="xs">
          {results.map((row) => (
            <Paper key={row.pluginId} withBorder p="xs" radius="md">
              <Group justify="space-between" wrap="nowrap" align="baseline">
                <Text size="sm" fw={500}>
                  {row.pluginName}
                </Text>
                {row.error ? (
                  <Text size="xs" c="red">
                    {row.error}
                  </Text>
                ) : (
                  <Text size="xs" c="dimmed">
                    {row.novels.length} result
                    {row.novels.length === 1 ? "" : "s"}
                  </Text>
                )}
              </Group>
              {row.novels.length > 0 ? (
                <Stack gap={2} mt="xs">
                  {row.novels.slice(0, 5).map((novel) => (
                    <Text key={novel.path} size="sm" truncate>
                      • {novel.name}
                    </Text>
                  ))}
                  {row.novels.length > 5 ? (
                    <Text size="xs" c="dimmed">
                      … {row.novels.length - 5} more
                    </Text>
                  ) : null}
                </Stack>
              ) : null}
            </Paper>
          ))}
        </Stack>
      </Stack>
    </Container>
  );
}
