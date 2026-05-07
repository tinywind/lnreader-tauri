import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Anchor,
  Badge,
  Box,
  Drawer,
  Group,
  Loader,
  Stack,
  Text,
} from "@mantine/core";
import { PageFrame, PageHeader, StateView } from "../components/AppFrame";
import {
  ChevronDownGlyph,
  ExternalLinkGlyph,
  SettingsGlyph,
} from "../components/ActionGlyphs";
import { SegmentedToggle } from "../components/SegmentedToggle";
import { TextButton } from "../components/TextButton";
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
  type ResolvedFilterValues,
} from "../components/PluginFilters";
import { IconButton } from "../components/IconButton";
import { PluginSettingsEditor } from "../components/PluginSettingsEditor";
import { SearchBar } from "../components/SearchBar";
import { importNovelFromSource } from "../lib/plugins/import-novel";
import { FilterTypes, type Filters } from "../lib/plugins/filterTypes";
import { pluginManager } from "../lib/plugins/manager";
import {
  emptySourceFilterValues,
  readSourceFilters,
  writeSourceFilters,
} from "../lib/plugins/source-filter-storage";
import type { NovelItem, Plugin } from "../lib/plugins/types";
import {
  enqueueOpenSiteTask,
  enqueueSourceTask,
} from "../lib/tasks/source-tasks";
import { useTranslation } from "../i18n";
import { sourceRoute } from "../router";
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

function getOptionLabel(
  options: readonly { label: string; value: string }[],
  value: string,
): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

function formatActiveFilter(
  filter: Filters[string],
  value: unknown,
): string | null {
  switch (filter.type) {
    case FilterTypes.TextInput: {
      const text = typeof value === "string" ? value.trim() : "";
      return text ? `${filter.label}: ${text}` : null;
    }
    case FilterTypes.Switch:
      return value === true ? filter.label : null;
    case FilterTypes.Picker: {
      const selected = typeof value === "string" ? value : "";
      return selected
        ? `${filter.label}: ${getOptionLabel(filter.options, selected)}`
        : null;
    }
    case FilterTypes.CheckboxGroup: {
      const selected = Array.isArray(value) ? value : [];
      if (selected.length === 0) return null;
      const labels = selected.map((item) => getOptionLabel(filter.options, item));
      return `${filter.label}: ${labels.join(", ")}`;
    }
    case FilterTypes.ExcludableCheckboxGroup: {
      const selected =
        value && typeof value === "object" && !Array.isArray(value)
          ? (value as { exclude?: string[]; include?: string[] })
          : {};
      const include = selected.include ?? [];
      const exclude = selected.exclude ?? [];
      const labels = [
        ...include.map((item) => `+${getOptionLabel(filter.options, item)}`),
        ...exclude.map((item) => `-${getOptionLabel(filter.options, item)}`),
      ];
      return labels.length > 0 ? `${filter.label}: ${labels.join(", ")}` : null;
    }
    default:
      return null;
  }
}

function getActiveFilterLabels(
  schema: Filters,
  filters: ResolvedFilterValues,
): Array<{ key: string; label: string }> {
  return Object.entries(schema).flatMap(([key, filter]) => {
    const label = formatActiveFilter(filter, filters[key]?.value);
    return label ? [{ key, label }] : [];
  });
}

function hasPluginInputs(plugin: Plugin | null | undefined): boolean {
  if (!plugin) return false;
  return (
    Object.keys(plugin.pluginInputs ?? {}).length > 0 ||
    Object.keys(plugin.pluginSettings ?? {}).length > 0
  );
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

function BackGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M15 18l-6-6 6-6" />
      <path d="M9 12h11" />
    </svg>
  );
}

export function SourcePage() {
  const { t } = useTranslation();
  const { from, pluginId, query } = sourceRoute.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const plugin = pluginManager.getPlugin(pluginId);

  const [mode, setMode] = useState<ListingMode>("popular");
  const [page, setPage] = useState(1);
  const [accumulated, setAccumulated] = useState<NovelItem[]>([]);
  const [search, setSearch] = useState(query);
  const [submittedSearch, setSubmittedSearch] = useState(query);

  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false);
  const initialFilters = useMemo<ResolvedFilterValues>(
    () => (plugin?.filters ? readSourceFilters(plugin, plugin.filters) : {}),
    [plugin],
  );
  const [pendingFilters, setPendingFilters] =
    useState<ResolvedFilterValues>(initialFilters);
  const [activeFilters, setActiveFilters] =
    useState<ResolvedFilterValues>(initialFilters);

  useEffect(() => {
    setPendingFilters(initialFilters);
    setActiveFilters(initialFilters);
  }, [initialFilters]);

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
      const taskKind = isSearchMode
        ? "source.search"
        : mode === "latest"
          ? "source.listLatest"
          : "source.listPopular";
      const title = isSearchMode
        ? t("tasks.task.sourceSearch", {
            query: trimmedSearch,
            source: plugin.name,
          })
        : t("tasks.task.sourceList", {
            mode: mode === "popular" ? t("source.popular") : t("source.latest"),
            source: plugin.name,
          });
      return enqueueSourceTask<NovelItem[]>({
        plugin,
        kind: taskKind,
        priority: "interactive",
        title,
        subject: { path: `${mode}:${page}` },
        dedupeKey: `source.list:${plugin.id}:${mode}:${trimmedSearch}:${JSON.stringify(activeFilters)}:${page}`,
        run: async () => {
          if (isSearchMode) {
            return plugin.searchNovels(trimmedSearch, page);
          }
          return plugin.popularNovels(page, {
            showLatestNovels: mode === "latest",
            filters: activeFilters as never,
          });
        },
      }).promise;
    },
  });

  function openPluginSite(): void {
    if (!plugin) return;
    void enqueueOpenSiteTask(
      plugin,
      plugin.site,
      t("tasks.task.openSite", { source: plugin.name }),
    ).promise.catch(() => undefined);
  }

  useEffect(() => {
    if (listing.data) {
      setAccumulated((prev) =>
        page === 1 ? listing.data : [...prev, ...listing.data],
      );
    }
  }, [listing.data, page]);

  const open = useMutation({
    mutationFn: async (item: NovelItem) => {
      if (!plugin) throw new Error(t("source.pluginNotLoaded"));
      return enqueueSourceTask<number>({
        plugin,
        kind: "source.openNovel",
        priority: "interactive",
        title: t("tasks.task.openNovel", { name: item.name }),
        subject: { novelName: item.name, path: item.path },
        dedupeKey: `source.openNovel:${plugin.id}:${item.path}`,
        run: () => importNovelFromSource(plugin, item),
      }).promise;
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
          title={t("source.pluginNotLoaded")}
          message={t("source.pluginNotLoadedMessage", { id: pluginId })}
        />
      </PageFrame>
    );
  }

  const sourceFilters = plugin.filters;
  const filterCount = sourceFilters
    ? Object.keys(sourceFilters).length
    : 0;
  const hasPluginSettings = hasPluginInputs(plugin);
  const activeFilterCount = countActiveFilters(activeFilters);
  const hasNextPage =
    !listing.isFetching && !!listing.data && listing.data.length > 0;
  const showLoadMoreButton =
    hasNextPage || (listing.isFetching && page > 1);
  const sourceStatus: "active" | "done" | "error" = listing.error
    ? "error"
    : listing.isFetching
      ? "active"
      : "done";
  const modeLabel = mode === "popular" ? t("source.popular") : t("source.latest");
  const backToGlobalSearch = from === "browse-search";
  const activeFilterLabels = sourceFilters
    ? getActiveFilterLabels(sourceFilters, activeFilters)
    : [];

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
              openPluginSite();
            }}
          >
            {plugin.site}
          </Anchor>
        }
        actions={
          <>
            {backToGlobalSearch ? (
              <IconButton
                label={t("source.backToGlobalSearch")}
                size="lg"
                onClick={() => {
                  void navigate({ to: "/browse", search: { q: query } });
                }}
              >
                <BackGlyph />
              </IconButton>
            ) : null}
            {hasPluginSettings ? (
              <IconButton
                label={t("pluginSettings.open", { name: plugin.name })}
                size="lg"
                variant="subtle"
                onClick={() => setSettingsDrawerOpen(true)}
              >
                <SettingsGlyph />
              </IconButton>
            ) : null}
            <Badge variant="light">{plugin.lang}</Badge>
            <Badge variant="light" color="gray">
              v{plugin.version}
            </Badge>
          </>
        }
      />

      <div className="lnr-source-workbench">
        <aside className="lnr-source-tools">
          <ConsolePanel title={t("source.controls")}>
            <Stack gap="sm" p="sm">
              <SegmentedToggle
                value={mode}
                onChange={(value) => setMode(value as ListingMode)}
                data={[
                  { value: "popular", label: t("source.popular") },
                  { value: "latest", label: t("source.latest") },
                ]}
                disabled={isSearchMode}
              />

              <SearchBar
                value={search}
                onChange={setSearch}
                onSubmit={() => setSubmittedSearch(search)}
                placeholder={t("source.searchPlaceholder", {
                  name: plugin.name,
                })}
              />

              {filterCount > 0 ? (
                <div className="lnr-source-filter-row">
                  <TextButton
                    className="lnr-source-filter-trigger"
                    variant="light"
                    size="sm"
                    onClick={() => {
                      setPendingFilters(activeFilters);
                      setFilterDrawerOpen(true);
                    }}
                    disabled={isSearchMode}
                  >
                    {t("source.filtersButton", {
                      active: activeFilterCount,
                      total: filterCount,
                    })}
                  </TextButton>
                  {activeFilterLabels.map((filter) => (
                    <span
                      className="lnr-source-active-filter"
                      key={filter.key}
                      title={filter.label}
                    >
                      {filter.label}
                    </span>
                  ))}
                </div>
              ) : null}
            </Stack>
          </ConsolePanel>

          <ConsolePanel title={t("source.state")}>
            <div className="lnr-source-state-body">
              <Stack className="lnr-source-state-copy" gap="sm">
                <Group gap={6} wrap="wrap">
                  <ConsoleStatusDot
                    status={sourceStatus}
                    label={
                      listing.error
                        ? t("source.error")
                        : listing.isFetching
                          ? t("common.fetching")
                          : t("common.ready")
                    }
                  />
                  <ConsoleChip>{plugin.lang.toUpperCase()}</ConsoleChip>
                  <ConsoleChip>v{plugin.version}</ConsoleChip>
                  {isSearchMode ? (
                    <ConsoleChip active>{t("source.searchMode")}</ConsoleChip>
                  ) : (
                    <ConsoleChip active>{modeLabel}</ConsoleChip>
                  )}
                </Group>
                <Box style={{ minWidth: 0 }}>
                  <Text className="lnr-console-kicker">
                    {t("source.preparedOrigin")}
                  </Text>
                  <Anchor
                    size="sm"
                    truncate
                    onClick={(event) => {
                      event.preventDefault();
                      openPluginSite();
                    }}
                  >
                    {plugin.site}
                  </Anchor>
                </Box>
              </Stack>
              <IconButton
                label={t("common.openWebView")}
                size="lg"
                variant="default"
                onClick={openPluginSite}
              >
                <ExternalLinkGlyph />
              </IconButton>
            </div>
          </ConsolePanel>
        </aside>


        <section className="lnr-source-results-panel">
          <ConsoleSectionHeader
            eyebrow={
              isSearchMode
                ? t("source.searchEyebrow")
                : t("source.catalogEyebrow")
            }
            title={isSearchMode ? `"${trimmedSearch}"` : modeLabel}
            count={t("source.loadedCount", { count: accumulated.length })}
            actions={
              showLoadMoreButton ? (
                <IconButton
                  label={t("common.loadMore")}
                  variant="default"
                  size="lg"
                  onClick={() => setPage((p) => p + 1)}
                  loading={listing.isFetching && page > 1}
                  disabled={!hasNextPage}
                >
                  <ChevronDownGlyph />
                </IconButton>
              ) : null
            }
          />

          {listing.isLoading && page === 1 ? (
            <StateView
              title={
                <Group gap="sm">
                  <Loader size="sm" />
                  {isSearchMode
                    ? t("source.searching", {
                        name: plugin.name,
                        query: trimmedSearch,
                      })
                    : t("source.loadingMode", { mode: modeLabel })}
                </Group>
              }
            />
          ) : listing.error ? (
            <StateView
              color="red"
              title={t("source.error")}
              message={
                listing.error instanceof Error
                  ? listing.error.message
                  : String(listing.error)
              }
            />
          ) : accumulated.length === 0 ? (
            <StateView
              color="blue"
              title={t("source.noResults")}
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
              title={t("common.openFailed")}
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
        <span>
          {isSearchMode
            ? t("source.status.search", { query: trimmedSearch })
            : t("source.status.mode", { mode: modeLabel })}
        </span>
        <span>{t("source.status.page", { page })}</span>
        <span>{t("source.status.loadedNovels", { count: accumulated.length })}</span>
        <span>{t("source.status.activeFilters", { count: activeFilterCount })}</span>
      </ConsoleStatusStrip>

      {sourceFilters && (
        <Drawer
          opened={filterDrawerOpen}
          onClose={() => setFilterDrawerOpen(false)}
          title={t("source.drawerTitle", { name: plugin.name })}
          position="right"
          size="md"
        >
          <Stack gap="md">
            <PluginFilters
              schema={sourceFilters}
              values={pendingFilters}
              onChange={setPendingFilters}
            />
            <Group justify="space-between">
              <TextButton
                variant="subtle"
                onClick={() => {
                  setPendingFilters(emptySourceFilterValues(sourceFilters));
                }}
              >
                {t("common.reset")}
              </TextButton>
              <Group gap="xs">
                <TextButton
                  variant="default"
                  onClick={() => setFilterDrawerOpen(false)}
                >
                  {t("common.cancel")}
                </TextButton>
                <TextButton
                  onClick={() => {
                    setActiveFilters(pendingFilters);
                    writeSourceFilters(plugin, pendingFilters);
                    setFilterDrawerOpen(false);
                  }}
                >
                  {t("common.apply")}
                </TextButton>
              </Group>
            </Group>
          </Stack>
        </Drawer>
      )}
      {hasPluginSettings ? (
        <Drawer
          opened={settingsDrawerOpen}
          onClose={() => setSettingsDrawerOpen(false)}
          title={t("pluginSettings.title", { name: plugin.name })}
          position="right"
          size="md"
        >
          <PluginSettingsEditor
            key={plugin.id}
            plugin={plugin}
            onSaved={() => {
              setSettingsDrawerOpen(false);
              void listing.refetch();
            }}
          />
        </Drawer>
      ) : null}
    </PageFrame>
  );
}
