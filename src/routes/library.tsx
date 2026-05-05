import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Alert,
  Badge,
  Button,
  Container,
  Group,
  Loader,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  Title,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { CategoriesDrawer } from "../components/CategoriesDrawer";
import { LibraryGrid } from "../components/LibraryGrid";
import { LibrarySelectionToolbar } from "../components/LibrarySelectionToolbar";
import { SearchBar } from "../components/SearchBar";
import { insertNovel, listLibraryNovels } from "../db/queries/novel";
import {
  useLibraryStore,
  type DefaultChapterSort,
  type LibraryDisplayMode,
  type LibrarySortOrder,
} from "../store/library";

const SEARCH_DEBOUNCE_MS = 200;

const DISPLAY_MODE_OPTIONS = [
  { label: "Compact", value: "compact" },
  { label: "Comfortable", value: "comfortable" },
  { label: "Cover only", value: "cover-only" },
  { label: "List", value: "list" },
];

const SORT_ORDER_OPTIONS: { label: string; value: LibrarySortOrder }[] = [
  { label: "Alphabetically A-Z", value: "nameAsc" },
  { label: "Alphabetically Z-A", value: "nameDesc" },
  { label: "Downloaded chapters ascending", value: "downloadedAsc" },
  { label: "Downloaded chapters descending", value: "downloadedDesc" },
  { label: "Total chapters ascending", value: "totalChaptersAsc" },
  { label: "Total chapters descending", value: "totalChaptersDesc" },
  { label: "Unread chapters ascending", value: "unreadChaptersAsc" },
  { label: "Unread chapters descending", value: "unreadChaptersDesc" },
  { label: "Date added oldest first", value: "dateAddedAsc" },
  { label: "Date added newest first", value: "dateAddedDesc" },
  { label: "Last read oldest first", value: "lastReadAsc" },
  { label: "Last read newest first", value: "lastReadDesc" },
  { label: "Last updated oldest first", value: "lastUpdatedAsc" },
  { label: "Last updated newest first", value: "lastUpdatedDesc" },
];

export function LibraryPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const search = useLibraryStore((s) => s.search);
  const setSearch = useLibraryStore((s) => s.setSearch);
  const selectedCategoryId = useLibraryStore((s) => s.selectedCategoryId);
  const setSelectedCategoryId = useLibraryStore(
    (s) => s.setSelectedCategoryId,
  );
  const displayMode = useLibraryStore((s) => s.displayMode);
  const setDisplayMode = useLibraryStore((s) => s.setDisplayMode);
  const novelsPerRow = useLibraryStore((s) => s.novelsPerRow);
  const setNovelsPerRow = useLibraryStore((s) => s.setNovelsPerRow);
  const sortOrder = useLibraryStore((s) => s.sortOrder);
  const setSortOrder = useLibraryStore((s) => s.setSortOrder);
  const showDownloadBadges = useLibraryStore((s) => s.showDownloadBadges);
  const setShowDownloadBadges = useLibraryStore(
    (s) => s.setShowDownloadBadges,
  );
  const showUnreadBadges = useLibraryStore((s) => s.showUnreadBadges);
  const setShowUnreadBadges = useLibraryStore((s) => s.setShowUnreadBadges);
  const showNumberBadges = useLibraryStore((s) => s.showNumberBadges);
  const setShowNumberBadges = useLibraryStore((s) => s.setShowNumberBadges);
  const downloadedOnlyMode = useLibraryStore((s) => s.downloadedOnlyMode);
  const setDownloadedOnlyMode = useLibraryStore(
    (s) => s.setDownloadedOnlyMode,
  );
  const incognitoMode = useLibraryStore((s) => s.incognitoMode);
  const setIncognitoMode = useLibraryStore((s) => s.setIncognitoMode);
  const defaultChapterSort = useLibraryStore((s) => s.defaultChapterSort);
  const setDefaultChapterSort = useLibraryStore(
    (s) => s.setDefaultChapterSort,
  );
  const [debouncedSearch] = useDebouncedValue(search, SEARCH_DEBOUNCE_MS);

  const novels = useQuery({
    queryKey: [
      "novel",
      "library",
      {
        search: debouncedSearch,
        categoryId: selectedCategoryId,
        downloadedOnly: downloadedOnlyMode,
        sortOrder,
      },
    ] as const,
    queryFn: () =>
      listLibraryNovels({
        search: debouncedSearch,
        categoryId: selectedCategoryId,
        downloadedOnly: downloadedOnlyMode,
        sortOrder,
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
  const [categoriesOpen, setCategoriesOpen] = useState(false);

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
        return;
      }
      void navigate({ to: "/novel", search: { id } });
    },
    [selectedIds, toggleSelected, navigate],
  );

  const handleLongPress = useCallback(
    (id: number) => {
      toggleSelected(id);
    },
    [toggleSelected],
  );

  const filterActive =
    debouncedSearch.trim() !== "" ||
    selectedCategoryId !== null ||
    downloadedOnlyMode;

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
              variant="default"
              onClick={() => setCategoriesOpen(true)}
            >
              Categories
            </Button>
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

        <SearchBar value={search} onChange={setSearch} />

        <Stack gap="sm">
          <Group gap="sm" align="end">
            <Select
              label="Sort"
              data={SORT_ORDER_OPTIONS}
              value={sortOrder}
              onChange={(value) => {
                if (value) setSortOrder(value as LibrarySortOrder);
              }}
              w={{ base: "100%", sm: 280 }}
            />
            <NumberInput
              label="Novels per row"
              min={1}
              max={5}
              value={novelsPerRow}
              onChange={(value) => {
                if (typeof value === "number") setNovelsPerRow(value);
              }}
              disabled={displayMode === "list"}
              w={{ base: "100%", sm: 160 }}
            />
            <Select
              label="Default chapter sort"
              data={[
                { value: "asc", label: "Oldest first" },
                { value: "desc", label: "Newest first" },
              ]}
              value={defaultChapterSort}
              onChange={(value) => {
                if (value) setDefaultChapterSort(value as DefaultChapterSort);
              }}
              w={{ base: "100%", sm: 180 }}
            />
          </Group>
          <SegmentedControl
            data={DISPLAY_MODE_OPTIONS}
            value={displayMode}
            onChange={(value) =>
              setDisplayMode(value as LibraryDisplayMode)
            }
          />
          <Group gap="lg">
            <Switch
              label="Downloaded only"
              checked={downloadedOnlyMode}
              onChange={(event) =>
                setDownloadedOnlyMode(event.currentTarget.checked)
              }
            />
            <Switch
              label="Incognito"
              checked={incognitoMode}
              onChange={(event) =>
                setIncognitoMode(event.currentTarget.checked)
              }
            />
            <Switch
              label="Downloaded badges"
              checked={showDownloadBadges}
              onChange={(event) =>
                setShowDownloadBadges(event.currentTarget.checked)
              }
            />
            <Switch
              label="Unread badges"
              checked={showUnreadBadges}
              onChange={(event) =>
                setShowUnreadBadges(event.currentTarget.checked)
              }
            />
            <Switch
              label="Number badges"
              checked={showNumberBadges}
              onChange={(event) =>
                setShowNumberBadges(event.currentTarget.checked)
              }
            />
          </Group>
        </Stack>

        {selectedIds.size > 0 ? (
          <LibrarySelectionToolbar
            count={selectedIds.size}
            onClear={clearSelection}
          />
        ) : null}

        {novels.isLoading ? (
          <Group gap="sm">
            <Loader size="sm" />
            <Text c="dimmed">Loading library...</Text>
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
            displayMode={displayMode}
            novelsPerRow={novelsPerRow}
            showDownloadBadges={showDownloadBadges}
            showUnreadBadges={showUnreadBadges}
            showNumberBadges={showNumberBadges}
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

      <CategoriesDrawer
        opened={categoriesOpen}
        onClose={() => setCategoriesOpen(false)}
        selectedCategoryId={selectedCategoryId}
        onSelect={setSelectedCategoryId}
      />
    </Container>
  );
}
