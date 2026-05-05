import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Loader,
  Popover,
  ScrollArea,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { PageFrame, StateView } from "../components/AppFrame";
import { CategoriesDrawer } from "../components/CategoriesDrawer";
import { ConsoleStatusStrip } from "../components/ConsolePrimitives";
import { LibraryGrid } from "../components/LibraryGrid";
import { LibrarySettingsPanel } from "../components/LibrarySettingsPanel";
import {
  listCategories,
  type LibraryCategory,
} from "../db/queries/category";
import {
  listLibraryNovels,
  type LibraryNovel,
} from "../db/queries/novel";
import {
  useLibraryStore,
  type LibraryDisplayMode,
  type LibrarySortOrder,
} from "../store/library";
import "../styles/library.css";

const SEARCH_DEBOUNCE_MS = 200;

interface LibraryPageProps {
  active?: boolean;
}

const SORT_LABELS: Record<LibrarySortOrder, string> = {
  nameAsc: "Name A-Z",
  nameDesc: "Name Z-A",
  downloadedAsc: "Downloaded low",
  downloadedDesc: "Downloaded high",
  totalChaptersAsc: "Chapters low",
  totalChaptersDesc: "Chapters high",
  unreadChaptersAsc: "Unread low",
  unreadChaptersDesc: "Unread high",
  dateAddedAsc: "Oldest added",
  dateAddedDesc: "Newest added",
  lastReadAsc: "Oldest read",
  lastReadDesc: "Latest read",
  lastUpdatedAsc: "Oldest update",
  lastUpdatedDesc: "Latest update",
};

export function LibraryPage({ active = true }: LibraryPageProps) {
  const navigate = useNavigate();

  const search = useLibraryStore((s) => s.search);
  const setSearch = useLibraryStore((s) => s.setSearch);
  const selectedCategoryId = useLibraryStore((s) => s.selectedCategoryId);
  const setSelectedCategoryId = useLibraryStore(
    (s) => s.setSelectedCategoryId,
  );
  const sortOrder = useLibraryStore((s) => s.sortOrder);
  const displayMode = useLibraryStore((s) => s.displayMode);
  const setDisplayMode = useLibraryStore((s) => s.setDisplayMode);
  const novelsPerRow = useLibraryStore((s) => s.novelsPerRow);
  const showDownloadBadges = useLibraryStore((s) => s.showDownloadBadges);
  const showUnreadBadges = useLibraryStore((s) => s.showUnreadBadges);
  const showNumberBadges = useLibraryStore((s) => s.showNumberBadges);
  const downloadedOnlyMode = useLibraryStore((s) => s.downloadedOnlyMode);
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

  const categories = useQuery({
    queryKey: ["category", "list"],
    queryFn: listCategories,
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

  const rows = novels.data ?? [];
  const stats = getLibraryStats(rows);
  const activeCategory =
    selectedCategoryId == null
      ? "All"
      : (categories.data?.find((category) => category.id === selectedCategoryId)
          ?.name ?? "Selected category");
  const statusParts = [
    `${stats.totalNovels} novels`,
    `${stats.unreadChapters} unread`,
    `${stats.downloadedChapters}/${stats.totalChapters} downloaded`,
  ];
  const tags = getLibraryTags(rows);

  return (
    <>
      <PageFrame className="lnr-library-page" size="full">
        <div className="lnr-library-shell">
          <CategorySubpanel
            activeId={selectedCategoryId}
            categories={categories.data ?? []}
            currentCount={rows.length}
            error={categories.error}
            loading={categories.isLoading}
            onOpenDrawer={() => setCategoriesOpen(true)}
            onSelect={setSelectedCategoryId}
            tags={tags}
          />

          <section className="lnr-library-main" aria-label="Library novels">
            <header className="lnr-library-main-header">
              <div className="lnr-library-header-copy">
                <h1 className="lnr-library-title-heading">
                  Currently reading
                </h1>
                <span className="lnr-library-header-meta">
                  {`${rows.length} novels / sorted ${SORT_LABELS[sortOrder].toLowerCase()}`}
                </span>
              </div>
              <div className="lnr-library-header-actions">
                <UnstyledButton
                  className="lnr-library-mobile-category-button"
                  onClick={() => setCategoriesOpen(true)}
                >
                  Categories
                </UnstyledButton>
                <LibraryCommandSearch value={search} onChange={setSearch} />
                <ViewModeToggle
                  displayMode={displayMode}
                  onChange={setDisplayMode}
                />
                <Popover position="bottom-end" shadow="md" width={390}>
                  <Popover.Target>
                    <UnstyledButton
                      aria-label="Open library settings"
                      className="lnr-library-icon-button"
                      title="Library settings"
                    >
                      <SlidersIcon />
                    </UnstyledButton>
                  </Popover.Target>
                  <Popover.Dropdown className="lnr-library-settings-popover">
                    <LibrarySettingsPanel />
                  </Popover.Dropdown>
                </Popover>
              </div>
            </header>

            {selectedIds.size > 0 ? (
              <div className="lnr-library-selection-strip">
                <span>{`${selectedIds.size} selected`}</span>
                <UnstyledButton onClick={clearSelection}>Done</UnstyledButton>
              </div>
            ) : null}

            <div className="lnr-library-body">
              {novels.isLoading ? (
                <StateView
                  title={
                    <span className="lnr-library-loading-title">
                      <Loader size="sm" />
                      <Text c="dimmed" component="span">
                        Loading library...
                      </Text>
                    </span>
                  }
                />
              ) : novels.error ? (
                <StateView
                  color="red"
                  title="Database error"
                  message={
                    novels.error instanceof Error
                      ? novels.error.message
                      : String(novels.error)
                  }
                />
              ) : rows.length > 0 ? (
                <LibraryGrid
                  novels={rows}
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
                <StateView
                  color="yellow"
                  title="No matches"
                  message="No novels match the current filter. Clear the search or pick a different category."
                />
              ) : (
                <StateView
                  color="blue"
                  title="Empty library"
                  message="No novels yet. Add novels from Browse to start your library."
                />
              )}
            </div>

            <ConsoleStatusStrip className="lnr-library-status-strip">
              <span>{statusParts.join(" - ")}</span>
              <span>{`Updated ${stats.lastUpdatedLabel}`}</span>
              <span>{activeCategory}</span>
              <span>{`Sort ${SORT_LABELS[sortOrder]}`}</span>
            </ConsoleStatusStrip>
          </section>
        </div>
      </PageFrame>

      <CategoriesDrawer
        opened={active && categoriesOpen}
        onClose={() => setCategoriesOpen(false)}
        selectedCategoryId={selectedCategoryId}
        onSelect={setSelectedCategoryId}
      />
    </>
  );
}

interface CategorySubpanelProps {
  activeId: number | null;
  categories: readonly LibraryCategory[];
  currentCount: number;
  error: unknown;
  loading: boolean;
  onOpenDrawer: () => void;
  onSelect: (id: number | null) => void;
  tags: readonly LibraryTag[];
}

function CategorySubpanel({
  activeId,
  categories,
  currentCount,
  error,
  loading,
  onOpenDrawer,
  onSelect,
  tags,
}: CategorySubpanelProps) {
  return (
    <aside className="lnr-library-subpanel" aria-label="Library categories">
      <div className="lnr-library-subpanel-header">
        <Text className="lnr-console-kicker">Categories</Text>
      </div>
      <ScrollArea className="lnr-library-category-scroll">
        <div className="lnr-library-category-list">
          <CategoryButton
            active={activeId === null}
            count={activeId === null ? currentCount : undefined}
            label="All"
            onClick={() => onSelect(null)}
          />
          {loading ? (
            <Text className="lnr-library-subpanel-note">Loading...</Text>
          ) : error ? (
            <Text className="lnr-library-subpanel-note" c="red">
              {error instanceof Error ? error.message : String(error)}
            </Text>
          ) : categories.length > 0 ? (
            categories.map((category) => (
              <CategoryButton
                key={category.id}
                active={activeId === category.id}
                count={activeId === category.id ? currentCount : undefined}
                label={category.name}
                onClick={() => onSelect(category.id)}
              />
            ))
          ) : (
            <Text className="lnr-library-subpanel-note">
              No categories yet.
            </Text>
          )}

          <div className="lnr-library-tags">
            <div className="lnr-library-tags-title">Tags</div>
            {tags.length > 0 ? (
              tags.map((tag) => (
                <div className="lnr-library-tag-row" key={tag.label}>
                  <span>{`#${tag.label}`}</span>
                  <span>{tag.count}</span>
                </div>
              ))
            ) : (
              <Text className="lnr-library-subpanel-note">No tags</Text>
            )}
          </div>
        </div>
      </ScrollArea>
      <div className="lnr-library-subpanel-footer">
        <span>up/down navigate / enter select</span>
        <UnstyledButton onClick={onOpenDrawer}>
          Manage categories
        </UnstyledButton>
      </div>
    </aside>
  );
}

interface CategoryButtonProps {
  active: boolean;
  count?: number;
  label: string;
  onClick: () => void;
}

function CategoryButton({
  active,
  count,
  label,
  onClick,
}: CategoryButtonProps) {
  return (
    <UnstyledButton
      className="lnr-library-category"
      data-active={active}
      onClick={onClick}
    >
      <span className="lnr-library-category-label">{label}</span>
      <span className="lnr-library-category-count">{count ?? "-"}</span>
    </UnstyledButton>
  );
}

interface LibraryCommandSearchProps {
  onChange: (value: string) => void;
  value: string;
}

function LibraryCommandSearch({
  onChange,
  value,
}: LibraryCommandSearchProps) {
  return (
    <label className="lnr-library-command-search">
      <SearchIcon />
      <input
        aria-label="Search library"
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder="Search or jump..."
        value={value}
      />
      {value.length > 0 ? (
        <button
          aria-label="Clear search"
          onClick={() => onChange("")}
          type="button"
        >
          x
        </button>
      ) : (
        <kbd>Ctrl K</kbd>
      )}
    </label>
  );
}

const VIEW_MODE_OPTIONS: {
  icon: "cover" | "grid" | "list" | "rows";
  label: string;
  mode: LibraryDisplayMode;
}[] = [
  { icon: "grid", label: "Grid view", mode: "comfortable" },
  { icon: "list", label: "List view", mode: "list" },
  { icon: "rows", label: "Compact rows", mode: "compact" },
  { icon: "cover", label: "Cover only", mode: "cover-only" },
];

interface ViewModeToggleProps {
  displayMode: LibraryDisplayMode;
  onChange: (mode: LibraryDisplayMode) => void;
}

function ViewModeToggle({ displayMode, onChange }: ViewModeToggleProps) {
  return (
    <div className="lnr-library-view-toggle" role="group" aria-label="View mode">
      {VIEW_MODE_OPTIONS.map((option) => (
        <UnstyledButton
          aria-label={option.label}
          className="lnr-library-view-button"
          data-active={displayMode === option.mode}
          key={option.mode}
          onClick={() => onChange(option.mode)}
          title={option.label}
        >
          <ViewModeIcon icon={option.icon} />
        </UnstyledButton>
      ))}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="11" cy="11" r="7" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

function SlidersIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4 7h10" />
      <path d="M18 7h2" />
      <path d="M4 17h2" />
      <path d="M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </svg>
  );
}

function ViewModeIcon({ icon }: { icon: "cover" | "grid" | "list" | "rows" }) {
  switch (icon) {
    case "grid":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M4 4h7v7H4z" />
          <path d="M13 4h7v7h-7z" />
          <path d="M4 13h7v7H4z" />
          <path d="M13 13h7v7h-7z" />
        </svg>
      );
    case "list":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M8 6h12" />
          <path d="M8 12h12" />
          <path d="M8 18h12" />
          <path d="M4 6h.01" />
          <path d="M4 12h.01" />
          <path d="M4 18h.01" />
        </svg>
      );
    case "rows":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M4 5h16v4H4z" />
          <path d="M4 15h16v4H4z" />
        </svg>
      );
    case "cover":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M7 4h10v16H7z" />
          <path d="M10 7h4" />
          <path d="M10 17h4" />
        </svg>
      );
  }
}

interface LibraryTag {
  count: number;
  label: string;
}

function getLibraryTags(novels: readonly LibraryNovel[]): LibraryTag[] {
  const unread = novels.filter((novel) => novel.chaptersUnread > 0).length;
  const downloaded = novels.filter(
    (novel) => novel.chaptersDownloaded > 0,
  ).length;
  const local = novels.filter((novel) => novel.isLocal).length;
  const complete = novels.filter(
    (novel) => novel.totalChapters > 0 && novel.chaptersUnread === 0,
  ).length;

  return [
    { count: unread, label: "unread" },
    { count: downloaded, label: "downloaded" },
    { count: local, label: "local" },
    { count: complete, label: "complete" },
  ].filter((tag) => tag.count > 0);
}

function getLibraryStats(novels: readonly LibraryNovel[]) {
  const totalNovels = novels.length;
  const unreadChapters = novels.reduce(
    (sum, novel) => sum + novel.chaptersUnread,
    0,
  );
  const downloadedChapters = novels.reduce(
    (sum, novel) => sum + novel.chaptersDownloaded,
    0,
  );
  const totalChapters = novels.reduce(
    (sum, novel) => sum + novel.totalChapters,
    0,
  );
  const lastUpdatedAt = novels.reduce<number | null>(
    (latest, novel) =>
      latest == null || novel.lastUpdatedAt > latest
        ? novel.lastUpdatedAt
        : latest,
    null,
  );

  return {
    downloadedChapters,
    lastUpdatedLabel: formatRelativeTime(lastUpdatedAt),
    totalChapters,
    totalNovels,
    unreadChapters,
  };
}

function formatRelativeTime(value: number | null) {
  if (value == null || value <= 0) return "never";
  const timestamp = value < 1_000_000_000_000 ? value * 1000 : value;
  const diffMs = Date.now() - timestamp;
  if (diffMs < 60_000) return "just now";

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  return new Date(timestamp).toLocaleDateString();
}
