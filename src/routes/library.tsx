import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Button,
  Container,
  Group,
  Loader,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { LibraryGrid } from "../components/LibraryGrid";
import { LibrarySelectionToolbar } from "../components/LibrarySelectionToolbar";
import { insertNovel, listLibraryNovels } from "../db/queries/novel";
import { useLibraryStore } from "../store/library";

const SEARCH_DEBOUNCE_MS = 200;

export function LibraryPage() {
  const queryClient = useQueryClient();

  const search = useLibraryStore((s) => s.search);
  const selectedCategoryId = useLibraryStore((s) => s.selectedCategoryId);
  const [debouncedSearch] = useDebouncedValue(search, SEARCH_DEBOUNCE_MS);

  const novels = useQuery({
    queryKey: [
      "novel",
      "library",
      { search: debouncedSearch, categoryId: selectedCategoryId },
    ] as const,
    queryFn: () =>
      listLibraryNovels({
        search: debouncedSearch,
        categoryId: selectedCategoryId,
      }),
  });

  const seed = useMutation({
    mutationFn: async () => {
      const stamp = Date.now();
      await insertNovel({
        pluginId: "local",
        path: `local-${stamp}`,
        name: `Sample novel #${stamp}`,
        cover: null,
      });
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["novel"] }),
  });

  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(
    () => new Set(),
  );

  const toggleSelected = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleActivate = useCallback(
    (id: number) => {
      if (selectedIds.size > 0) {
        toggleSelected(id);
      }
      // TODO: Sprint 6 — navigate to /novel/${id}.
    },
    [selectedIds, toggleSelected],
  );

  const handleLongPress = useCallback(
    (id: number) => {
      toggleSelected(id);
    },
    [toggleSelected],
  );

  const filterActive =
    debouncedSearch.trim() !== "" || selectedCategoryId !== null;

  return (
    <Container size="lg" py="xl">
      <Stack gap="md">
        <Group justify="space-between" align="baseline">
          <Title order={1}>Library</Title>
          <Group gap="xs">
            <Badge variant="light" color="gray">
              Sprint 1
            </Badge>
            <Button
              size="xs"
              variant="light"
              loading={seed.isPending}
              onClick={() => seed.mutate()}
            >
              + Seed novel
            </Button>
          </Group>
        </Group>

        {selectedIds.size > 0 ? (
          <LibrarySelectionToolbar
            count={selectedIds.size}
            onClear={clearSelection}
          />
        ) : null}

        {novels.isLoading ? (
          <Group gap="sm">
            <Loader size="sm" />
            <Text c="dimmed">Loading library…</Text>
          </Group>
        ) : novels.error ? (
          <Alert color="red" title="Database error">
            {novels.error instanceof Error
              ? novels.error.message
              : String(novels.error)}
          </Alert>
        ) : novels.data && novels.data.length > 0 ? (
          <LibraryGrid
            novels={novels.data}
            selectedIds={selectedIds}
            onActivate={handleActivate}
            onLongPress={handleLongPress}
          />
        ) : filterActive ? (
          <Alert color="yellow" title="No matches">
            No novels match the current filter. Clear the search or pick
            a different category.
          </Alert>
        ) : (
          <Alert color="blue" title="Empty library">
            No novels yet. Click "+ Seed novel" to insert a sample row.
          </Alert>
        )}
      </Stack>
    </Container>
  );
}
