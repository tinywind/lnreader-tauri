import {
  Group,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Switch,
} from "@mantine/core";
import {
  useLibraryStore,
  type DefaultChapterSort,
  type LibraryDisplayMode,
  type LibrarySortOrder,
} from "../store/library";

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

export function LibrarySettingsPanel() {
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

  return (
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
        onChange={(value) => setDisplayMode(value as LibraryDisplayMode)}
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
  );
}
