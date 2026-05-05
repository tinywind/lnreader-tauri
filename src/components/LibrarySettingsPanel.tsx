import {
  Group,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Switch,
} from "@mantine/core";
import { useTranslation, type TranslationKey } from "../i18n";
import {
  useLibraryStore,
  type DefaultChapterSort,
  type LibraryDisplayMode,
  type LibrarySortOrder,
} from "../store/library";

const DISPLAY_MODE_LABEL_KEYS: Record<LibraryDisplayMode, TranslationKey> = {
  compact: "librarySettings.display.compact",
  comfortable: "librarySettings.display.comfortable",
  "cover-only": "librarySettings.display.coverOnly",
  list: "librarySettings.display.list",
};

const SORT_ORDER_LABEL_KEYS: Record<LibrarySortOrder, TranslationKey> = {
  nameAsc: "librarySettings.sort.nameAsc",
  nameDesc: "librarySettings.sort.nameDesc",
  downloadedAsc: "librarySettings.sort.downloadedAsc",
  downloadedDesc: "librarySettings.sort.downloadedDesc",
  totalChaptersAsc: "librarySettings.sort.totalChaptersAsc",
  totalChaptersDesc: "librarySettings.sort.totalChaptersDesc",
  unreadChaptersAsc: "librarySettings.sort.unreadChaptersAsc",
  unreadChaptersDesc: "librarySettings.sort.unreadChaptersDesc",
  dateAddedAsc: "librarySettings.sort.dateAddedAsc",
  dateAddedDesc: "librarySettings.sort.dateAddedDesc",
  lastReadAsc: "librarySettings.sort.lastReadAsc",
  lastReadDesc: "librarySettings.sort.lastReadDesc",
  lastUpdatedAsc: "librarySettings.sort.lastUpdatedAsc",
  lastUpdatedDesc: "librarySettings.sort.lastUpdatedDesc",
};

const DISPLAY_MODES: LibraryDisplayMode[] = [
  "compact",
  "comfortable",
  "cover-only",
  "list",
];

const SORT_ORDERS: LibrarySortOrder[] = [
  "nameAsc",
  "nameDesc",
  "downloadedAsc",
  "downloadedDesc",
  "totalChaptersAsc",
  "totalChaptersDesc",
  "unreadChaptersAsc",
  "unreadChaptersDesc",
  "dateAddedAsc",
  "dateAddedDesc",
  "lastReadAsc",
  "lastReadDesc",
  "lastUpdatedAsc",
  "lastUpdatedDesc",
];

export function LibrarySettingsPanel() {
  const { t } = useTranslation();
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
          label={t("librarySettings.sort")}
          data={SORT_ORDERS.map((value) => ({
            value,
            label: t(SORT_ORDER_LABEL_KEYS[value]),
          }))}
          value={sortOrder}
          onChange={(value) => {
            if (value) setSortOrder(value as LibrarySortOrder);
          }}
          w={{ base: "100%", sm: 280 }}
        />
        <NumberInput
          label={t("librarySettings.novelsPerRow")}
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
          label={t("librarySettings.defaultChapterSort")}
          data={[
            { value: "asc", label: t("librarySettings.oldestFirst") },
            { value: "desc", label: t("librarySettings.newestFirst") },
          ]}
          value={defaultChapterSort}
          onChange={(value) => {
            if (value) setDefaultChapterSort(value as DefaultChapterSort);
          }}
          w={{ base: "100%", sm: 180 }}
        />
      </Group>
      <SegmentedControl
        data={DISPLAY_MODES.map((value) => ({
          value,
          label: t(DISPLAY_MODE_LABEL_KEYS[value]),
        }))}
        value={displayMode}
        onChange={(value) => setDisplayMode(value as LibraryDisplayMode)}
      />
      <Group gap="lg">
        <Switch
          label={t("librarySettings.incognito")}
          checked={incognitoMode}
          onChange={(event) =>
            setIncognitoMode(event.currentTarget.checked)
          }
        />
        <Switch
          label={t("librarySettings.downloadedBadges")}
          checked={showDownloadBadges}
          onChange={(event) =>
            setShowDownloadBadges(event.currentTarget.checked)
          }
        />
        <Switch
          label={t("librarySettings.unreadBadges")}
          checked={showUnreadBadges}
          onChange={(event) =>
            setShowUnreadBadges(event.currentTarget.checked)
          }
        />
        <Switch
          label={t("librarySettings.numberBadges")}
          checked={showNumberBadges}
          onChange={(event) =>
            setShowNumberBadges(event.currentTarget.checked)
          }
        />
      </Group>
    </Stack>
  );
}
