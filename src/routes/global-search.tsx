import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Group,
  Loader,
  SegmentedControl,
  Stack,
  Text,
} from "@mantine/core";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  ConsoleChip,
  ConsoleCover,
  ConsoleSectionHeader,
  ConsoleStatusDot,
  ConsoleStatusStrip,
} from "../components/ConsolePrimitives";
import { SearchBar } from "../components/SearchBar";
import {
  globalSearch,
  type GlobalSearchResult,
} from "../lib/plugins/global-search";
import { importNovelFromSource } from "../lib/plugins/import-novel";
import { pluginManager } from "../lib/plugins/manager";
import type { NovelItem, Plugin } from "../lib/plugins/types";
import { useBrowseStore } from "../store/browse";
import { useSiteBrowserStore } from "../store/site-browser";
import "../styles/browse.css";

const PREVIEW_RESULT_COUNT = 5;
let activeSearchController: AbortController | null = null;
let activeSearchKey: string | null = null;

type ScopeMode = "all" | "pinned" | "selected";
type ResultSortMode = "pinned" | "count" | "source";

interface ResultViewRow {
  pending: boolean;
  plugin: Plugin;
  result: GlobalSearchResult | null;
}

function resultKey(pluginId: string, novelPath: string): string {
  return `${pluginId}::${novelPath}`;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isCloudflareError(message: string): boolean {
  return /cloudflare|challenge|captcha|403|forbidden/i.test(message);
}

function sortPluginsByName(plugins: readonly Plugin[]): Plugin[] {
  return [...plugins].sort((a, b) => a.name.localeCompare(b.name));
}

function pluginInitial(plugin: Plugin): string {
  return (plugin.name.trim()[0] ?? "?").toUpperCase();
}

function rowResultCount(row: ResultViewRow): number {
  return row.result?.novels.length ?? 0;
}

interface ScopePanelProps {
  installedPlugins: readonly Plugin[];
  languageFilter: readonly string[];
  lastUsedPlugin: Plugin | null;
  pinnedPluginIds: readonly string[];
  scopeMode: ScopeMode;
  scopedCount: number;
  selectedPluginIds: readonly string[];
  onClearLanguages: () => void;
  onClearSelected: () => void;
  onScopeModeChange: (mode: ScopeMode) => void;
  onToggleSelectedPlugin: (pluginId: string) => void;
}

function ScopePanel({
  installedPlugins,
  languageFilter,
  lastUsedPlugin,
  pinnedPluginIds,
  scopeMode,
  scopedCount,
  selectedPluginIds,
  onClearLanguages,
  onClearSelected,
  onScopeModeChange,
  onToggleSelectedPlugin,
}: ScopePanelProps) {
  const pinnedPlugins = installedPlugins.filter((plugin) =>
    pinnedPluginIds.includes(plugin.id),
  );
  return (
    <aside className="lnr-search-scope">
      <ConsoleSectionHeader
        eyebrow="Search scope"
        title="Before fan-out"
        count={`${scopedCount}/${installedPlugins.length}`}
      />

      <SegmentedControl
        value={scopeMode}
        onChange={(value) => onScopeModeChange(value as ScopeMode)}
        data={[
          { value: "all", label: `All ${installedPlugins.length}` },
          { value: "pinned", label: `Pinned ${pinnedPlugins.length}` },
          { value: "selected", label: `Selected ${selectedPluginIds.length}` },
        ]}
        size="xs"
        fullWidth
        className="lnr-console-segmented"
      />

      <div className="lnr-search-scope-block">
        <Text className="lnr-console-kicker">Languages</Text>
        <Group gap={6} wrap="wrap">
          {languageFilter.length === 0 ? (
            <ConsoleChip active>All languages</ConsoleChip>
          ) : (
            languageFilter.map((language) => (
              <ConsoleChip key={language} active>
                {language.toUpperCase()}
              </ConsoleChip>
            ))
          )}
          {languageFilter.length > 0 ? (
            <Button size="compact-xs" variant="subtle" onClick={onClearLanguages}>
              Clear
            </Button>
          ) : null}
        </Group>
      </div>

      {lastUsedPlugin ? (
        <div className="lnr-search-scope-block">
          <Text className="lnr-console-kicker">Recently used</Text>
          <button
            type="button"
            className="lnr-search-source-chip"
            data-active={selectedPluginIds.includes(lastUsedPlugin.id)}
            onClick={() => {
              if (!selectedPluginIds.includes(lastUsedPlugin.id)) {
                onToggleSelectedPlugin(lastUsedPlugin.id);
              }
              onScopeModeChange("selected");
            }}
          >
            <span className="lnr-search-source-icon">
              {pluginInitial(lastUsedPlugin)}
            </span>
            <span>{lastUsedPlugin.name}</span>
          </button>
        </div>
      ) : null}

      <div className="lnr-search-scope-block">
        <Text className="lnr-console-kicker">Source selection</Text>
        <div className="lnr-search-source-list">
          {installedPlugins.map((plugin) => {
            const active = selectedPluginIds.includes(plugin.id);
            return (
              <button
                key={plugin.id}
                type="button"
                className="lnr-search-source-chip"
                data-active={active}
                aria-pressed={active}
                onClick={() => onToggleSelectedPlugin(plugin.id)}
              >
                <span className="lnr-search-source-icon">
                  {pluginInitial(plugin)}
                </span>
                <span>{plugin.name}</span>
                {pinnedPluginIds.includes(plugin.id) ? (
                  <span className="lnr-search-source-meta">Pinned</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <ConsoleStatusStrip className="lnr-search-scope-strip">
        <span>{selectedPluginIds.length} selected</span>
        <Button size="compact-xs" variant="subtle" onClick={onClearSelected}>
          Clear selected
        </Button>
      </ConsoleStatusStrip>
    </aside>
  );
}

interface ActiveScopeRowProps {
  hideEmpty: boolean;
  languageFilter: readonly string[];
  scopeMode: ScopeMode;
  scopedCount: number;
  selectedCount: number;
  showFailures: boolean;
}

function ActiveScopeRow({
  hideEmpty,
  languageFilter,
  scopeMode,
  scopedCount,
  selectedCount,
  showFailures,
}: ActiveScopeRowProps) {
  return (
    <Group className="lnr-search-active-row" gap={6} wrap="wrap">
      <Text className="lnr-console-kicker">Active</Text>
      <ConsoleChip active>{scopeMode}</ConsoleChip>
      <ConsoleChip active>{scopedCount} sources</ConsoleChip>
      {scopeMode === "selected" ? (
        <ConsoleChip active>{selectedCount} selected</ConsoleChip>
      ) : null}
      {languageFilter.length === 0 ? (
        <ConsoleChip>All languages</ConsoleChip>
      ) : (
        languageFilter.map((language) => (
          <ConsoleChip key={language} active>
            {language.toUpperCase()}
          </ConsoleChip>
        ))
      )}
      {hideEmpty ? <ConsoleChip active>Hide empty</ConsoleChip> : null}
      {showFailures ? <ConsoleChip tone="error">Failures visible</ConsoleChip> : null}
    </Group>
  );
}

interface ResultFiltersProps {
  failedCount: number;
  hideEmpty: boolean;
  onHideEmptyChange: (hideEmpty: boolean) => void;
  onRetryFailed: () => void;
  onShowFailuresChange: (showFailures: boolean) => void;
  onSortModeChange: (sortMode: ResultSortMode) => void;
  showFailures: boolean;
  sortMode: ResultSortMode;
}

function ResultFilters({
  failedCount,
  hideEmpty,
  onHideEmptyChange,
  onRetryFailed,
  onShowFailuresChange,
  onSortModeChange,
  showFailures,
  sortMode,
}: ResultFiltersProps) {
  return (
    <Group className="lnr-search-result-filters" gap={6} wrap="wrap">
      <Button
        size="compact-xs"
        variant={hideEmpty ? "light" : "default"}
        onClick={() => onHideEmptyChange(!hideEmpty)}
      >
        Hide empty
      </Button>
      <Button
        size="compact-xs"
        color="red"
        variant={showFailures ? "light" : "default"}
        onClick={() => onShowFailuresChange(!showFailures)}
      >
        Failures {failedCount}
      </Button>
      <SegmentedControl
        value={sortMode}
        onChange={(value) => onSortModeChange(value as ResultSortMode)}
        data={[
          { value: "pinned", label: "Pinned" },
          { value: "count", label: "Count" },
          { value: "source", label: "Source" },
        ]}
        size="xs"
        className="lnr-console-segmented lnr-search-sort"
      />
      {failedCount > 0 ? (
        <Button size="compact-xs" color="red" variant="subtle" onClick={onRetryFailed}>
          Retry failed
        </Button>
      ) : null}
    </Group>
  );
}

interface SearchSummaryProps {
  emptyCount: number;
  failedCount: number;
  pendingCount: number;
  query: string;
  searchedCount: number;
  totalPluginCount: number;
  withResultsCount: number;
}

function SearchSummary({
  emptyCount,
  failedCount,
  pendingCount,
  query,
  searchedCount,
  totalPluginCount,
  withResultsCount,
}: SearchSummaryProps) {
  return (
    <ConsoleStatusStrip className="lnr-search-summary">
      <span className="lnr-search-summary-query">"{query}"</span>
      <span>
        searched {searchedCount}/{totalPluginCount}
      </span>
      <span>{withResultsCount} with results</span>
      <span>{emptyCount} empty</span>
      <span data-tone={failedCount > 0 ? "error" : undefined}>
        {failedCount} failed
      </span>
      {pendingCount > 0 ? <span>{pendingCount} pending</span> : null}
    </ConsoleStatusStrip>
  );
}

interface SearchResultSectionProps {
  openingKey: string | null;
  pinned: boolean;
  row: ResultViewRow;
  onMore: (row: GlobalSearchResult) => void;
  onOpen: (row: GlobalSearchResult, novel: NovelItem) => void;
  onOpenWebView: (plugin: Plugin) => void;
  onRetry: () => void;
}

function SearchResultSection({
  openingKey,
  pinned,
  row,
  onMore,
  onOpen,
  onOpenWebView,
  onRetry,
}: SearchResultSectionProps) {
  const { plugin, result } = row;
  const previewNovels = result?.novels.slice(0, PREVIEW_RESULT_COUNT) ?? [];
  const error = result?.error;
  const cloudflare = error ? isCloudflareError(error) : false;
  const status: "active" | "done" | "idle" | "warning" | "error" = row.pending
    ? "active"
    : error
      ? cloudflare
        ? "warning"
        : "error"
      : previewNovels.length > 0
        ? "done"
        : "idle";
  const statusLabel = row.pending
    ? "Searching"
    : error
      ? cloudflare
        ? "WebView needed"
        : "Failed"
      : `${result?.novels.length ?? 0} results`;

  return (
    <section className="lnr-search-result-row">
      <Group className="lnr-search-result-head" gap="sm" wrap="nowrap">
        <span className="lnr-search-source-icon">{pluginInitial(plugin)}</span>
        <Box className="lnr-search-result-title">
          <Group gap={6} wrap="nowrap">
            <Text size="sm" fw={700} truncate>
              {plugin.name}
            </Text>
            {pinned ? <ConsoleChip active>Pinned</ConsoleChip> : null}
            <ConsoleChip>{plugin.lang.toUpperCase()}</ConsoleChip>
          </Group>
          <Text size="xs" c="dimmed" truncate>
            {plugin.site}
          </Text>
        </Box>
        <ConsoleStatusDot status={status} label={statusLabel} />
        <Group gap={6} wrap="nowrap">
          {error ? (
            <>
              <Button size="compact-xs" variant="subtle" onClick={onRetry}>
                Retry
              </Button>
              <Button
                size="compact-xs"
                variant="light"
                onClick={() => onOpenWebView(plugin)}
              >
                Open WebView
              </Button>
            </>
          ) : result && result.novels.length > 0 ? (
            <Button size="compact-xs" variant="light" onClick={() => onMore(result)}>
              More
            </Button>
          ) : null}
        </Group>
      </Group>

      {error ? (
        <Alert
          color={cloudflare ? "yellow" : "red"}
          variant="light"
          className="lnr-search-diagnostic"
        >
          {error}
        </Alert>
      ) : previewNovels.length > 0 && result ? (
        <div className="lnr-search-preview-strip">
          {previewNovels.map((novel, index) => {
            const key = resultKey(result.pluginId, novel.path);
            return (
              <button
                key={`${key}::${index}`}
                type="button"
                className="lnr-search-preview-card"
                data-selected={openingKey === key}
                onClick={() => onOpen(result, novel)}
              >
                <ConsoleCover
                  alt={novel.name}
                  src={novel.cover ?? null}
                  width={74}
                  height={108}
                />
                <span title={novel.name}>{novel.name}</span>
              </button>
            );
          })}
        </div>
      ) : row.pending ? (
        <Group gap="sm" className="lnr-search-pending">
          <Loader size="xs" />
          <Text size="xs" c="dimmed">
            Waiting for this source to finish.
          </Text>
        </Group>
      ) : (
        <Text className="lnr-search-empty-row" size="sm" c="dimmed">
          No results from this source.
        </Text>
      )}
    </section>
  );
}

interface PluginSearchSectionProps {
  installedPlugins?: readonly Plugin[];
  query: string;
  onSearch: (query: string) => void;
}

export function PluginSearchSection({
  installedPlugins: installedPluginSnapshot,
  query,
  onSearch,
}: PluginSearchSectionProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const openSiteBrowser = useSiteBrowserStore((s) => s.openAt);
  const pluginLanguageFilter = useBrowseStore((s) => s.pluginLanguageFilter);
  const setPluginLanguageFilter = useBrowseStore(
    (s) => s.setPluginLanguageFilter,
  );
  const globalSearchConcurrency = useBrowseStore(
    (s) => s.globalSearchConcurrency,
  );
  const setLastUsedPluginId = useBrowseStore((s) => s.setLastUsedPluginId);
  const pinnedPluginIds = useBrowseStore((s) => s.pinnedPluginIds);
  const lastUsedPluginId = useBrowseStore((s) => s.lastUsedPluginId);
  const currentSearchKey = useBrowseStore((s) => s.globalSearch.searchKey);
  const globalSearchState = useBrowseStore((s) => s.globalSearch);
  const beginGlobalSearch = useBrowseStore((s) => s.beginGlobalSearch);
  const appendGlobalSearchResult = useBrowseStore(
    (s) => s.appendGlobalSearchResult,
  );
  const finishGlobalSearch = useBrowseStore((s) => s.finishGlobalSearch);
  const clearGlobalSearch = useBrowseStore((s) => s.clearGlobalSearch);
  const [search, setSearch] = useState(query);
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [scopeMode, setScopeMode] = useState<ScopeMode>("all");
  const [selectedPluginIds, setSelectedPluginIds] = useState<string[]>([]);
  const [hideEmpty, setHideEmpty] = useState(true);
  const [showFailures, setShowFailures] = useState(true);
  const [sortMode, setSortMode] = useState<ResultSortMode>("pinned");
  const [retryToken, setRetryToken] = useState(0);
  const trimmedQuery = query.trim();
  const installedPlugins = useMemo(
    () => sortPluginsByName(installedPluginSnapshot ?? pluginManager.list()),
    [installedPluginSnapshot],
  );
  const searchablePlugins = useMemo(
    () =>
      installedPlugins.filter(
        (plugin) =>
          pluginLanguageFilter.length === 0 ||
          pluginLanguageFilter.includes(plugin.lang),
      ),
    [installedPlugins, pluginLanguageFilter],
  );
  const scopedPlugins = useMemo(() => {
    if (scopeMode === "pinned") {
      return searchablePlugins.filter((plugin) =>
        pinnedPluginIds.includes(plugin.id),
      );
    }
    if (scopeMode === "selected") {
      return searchablePlugins.filter((plugin) =>
        selectedPluginIds.includes(plugin.id),
      );
    }
    return searchablePlugins;
  }, [pinnedPluginIds, scopeMode, searchablePlugins, selectedPluginIds]);
  const lastUsedPlugin =
    installedPlugins.find((plugin) => plugin.id === lastUsedPluginId) ?? null;
  const searchKey = useMemo(
    () =>
      [
        trimmedQuery,
        globalSearchConcurrency,
        scopeMode,
        retryToken,
        ...scopedPlugins.map((plugin) => plugin.id),
      ].join("\u0000"),
    [
      globalSearchConcurrency,
      retryToken,
      scopeMode,
      scopedPlugins,
      trimmedQuery,
    ],
  );
  const isCurrentSearch =
    trimmedQuery !== "" && globalSearchState.searchKey === searchKey;
  const results = isCurrentSearch ? globalSearchState.results : [];
  const searching = isCurrentSearch && globalSearchState.searching;
  const resultMap = useMemo(
    () => new Map(results.map((row) => [row.pluginId, row])),
    [results],
  );
  const rows = useMemo<ResultViewRow[]>(
    () =>
      trimmedQuery === ""
        ? []
        : scopedPlugins.map((plugin) => {
            const result = resultMap.get(plugin.id) ?? null;
            return {
              plugin,
              result,
              pending: searching && result === null,
            };
          }),
    [resultMap, scopedPlugins, searching, trimmedQuery],
  );
  const filteredRows = useMemo(() => {
    const next = rows.filter((row) => {
      if (row.pending) return true;
      if (!row.result) return false;
      if (row.result.error) return showFailures;
      if (row.result.novels.length === 0) return !hideEmpty;
      return true;
    });

    return next.sort((a, b) => {
      if (sortMode === "count") {
        return rowResultCount(b) - rowResultCount(a);
      }
      if (sortMode === "source") {
        return a.plugin.name.localeCompare(b.plugin.name);
      }
      const aPinned = pinnedPluginIds.includes(a.plugin.id) ? 1 : 0;
      const bPinned = pinnedPluginIds.includes(b.plugin.id) ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;
      return rowResultCount(b) - rowResultCount(a);
    });
  }, [hideEmpty, pinnedPluginIds, rows, showFailures, sortMode]);
  const installedCount = searchablePlugins.length;
  const totalPluginCount = isCurrentSearch
    ? globalSearchState.totalPluginCount
    : scopedPlugins.length;
  const hasSearchTerm = trimmedQuery !== "";
  const searchedCount = results.length;
  const failedCount = results.filter((row) => row.error).length;
  const withResultsCount = results.filter((row) => row.novels.length > 0).length;
  const emptyCount = results.filter(
    (row) => !row.error && row.novels.length === 0,
  ).length;
  const pendingCount = Math.max(0, totalPluginCount - searchedCount);
  const hasOnlyEmptyResults =
    hasSearchTerm &&
    !searching &&
    results.length > 0 &&
    results.every((row) => row.novels.length === 0 && !row.error);

  useEffect(() => {
    setSearch(query);
  }, [query]);

  useEffect(() => {
    const pluginIds = new Set(searchablePlugins.map((plugin) => plugin.id));
    setSelectedPluginIds((current) =>
      current.filter((pluginId) => pluginIds.has(pluginId)),
    );
  }, [searchablePlugins]);

  useEffect(() => {
    setOpenError(null);

    if (trimmedQuery === "" || scopedPlugins.length === 0) {
      activeSearchController?.abort();
      activeSearchController = null;
      activeSearchKey = null;
      clearGlobalSearch();
      return;
    }

    if (currentSearchKey === searchKey) {
      return;
    }

    activeSearchController?.abort();
    const controller = new AbortController();
    activeSearchController = controller;
    activeSearchKey = searchKey;
    beginGlobalSearch({
      query: trimmedQuery,
      searchKey,
      results: [],
      searching: true,
      totalPluginCount: scopedPlugins.length,
    });

    globalSearch(pluginManager, trimmedQuery, {
      concurrency: globalSearchConcurrency,
      plugins: scopedPlugins,
      signal: controller.signal,
      onResult: (result) => {
        if (controller.signal.aborted) return;
        appendGlobalSearchResult(searchKey, result);
      },
    })
      .catch(() => {
        // Per-plugin errors fold into GlobalSearchResult rows.
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          finishGlobalSearch(searchKey);
        }
        if (activeSearchKey === searchKey) {
          activeSearchController = null;
          activeSearchKey = null;
        }
      });
  }, [
    appendGlobalSearchResult,
    beginGlobalSearch,
    clearGlobalSearch,
    currentSearchKey,
    finishGlobalSearch,
    globalSearchConcurrency,
    scopedPlugins,
    searchKey,
    trimmedQuery,
  ]);

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
    onSearch(search.trim());
  };

  const openPluginResults = useCallback(
    (row: GlobalSearchResult) => {
      setLastUsedPluginId(row.pluginId);
      void navigate({
        to: "/source",
        search: { pluginId: row.pluginId, query: trimmedQuery },
      });
    },
    [navigate, setLastUsedPluginId, trimmedQuery],
  );

  const retryFailed = useCallback(() => {
    setRetryToken((value) => value + 1);
  }, []);

  const toggleSelectedPlugin = useCallback((pluginId: string) => {
    setSelectedPluginIds((current) =>
      current.includes(pluginId)
        ? current.filter((id) => id !== pluginId)
        : [...current, pluginId],
    );
  }, []);

  return (
    <div className="lnr-search-console">
      <ScopePanel
        installedPlugins={searchablePlugins}
        languageFilter={pluginLanguageFilter}
        lastUsedPlugin={lastUsedPlugin}
        pinnedPluginIds={pinnedPluginIds}
        scopeMode={scopeMode}
        scopedCount={scopedPlugins.length}
        selectedPluginIds={selectedPluginIds}
        onClearLanguages={() => setPluginLanguageFilter([])}
        onClearSelected={() => setSelectedPluginIds([])}
        onScopeModeChange={setScopeMode}
        onToggleSelectedPlugin={toggleSelectedPlugin}
      />

      <section className="lnr-search-results">
        <ConsoleSectionHeader
          eyebrow="/browse global search"
          title="Search installed sources"
          count={`${installedCount} eligible`}
        />

        <SearchBar
          value={search}
          onChange={setSearch}
          onSubmit={submitSearch}
          placeholder="Search across installed sources..."
        />

        <ActiveScopeRow
          hideEmpty={hideEmpty}
          languageFilter={pluginLanguageFilter}
          scopeMode={scopeMode}
          scopedCount={scopedPlugins.length}
          selectedCount={selectedPluginIds.length}
          showFailures={showFailures}
        />

        {installedCount === 0 ? (
          <Alert color="blue" title="No plugins available">
            Install a plugin, clear the language filter, or enable a matching
            language to use global search.
          </Alert>
        ) : null}

        {hasSearchTerm && scopedPlugins.length === 0 ? (
          <Alert color="yellow" title="No sources in scope">
            Change the scope or select at least one source before searching.
          </Alert>
        ) : null}

        {hasSearchTerm ? (
          <>
            <SearchSummary
              emptyCount={emptyCount}
              failedCount={failedCount}
              pendingCount={pendingCount}
              query={trimmedQuery}
              searchedCount={searchedCount}
              totalPluginCount={totalPluginCount}
              withResultsCount={withResultsCount}
            />
            <ResultFilters
              failedCount={failedCount}
              hideEmpty={hideEmpty}
              onHideEmptyChange={setHideEmpty}
              onRetryFailed={retryFailed}
              onShowFailuresChange={setShowFailures}
              onSortModeChange={setSortMode}
              showFailures={showFailures}
              sortMode={sortMode}
            />
          </>
        ) : null}

        {openingKey !== null ? (
          <Group gap="sm" className="lnr-search-inline-state">
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
            None of the selected sources matched "{query}".
          </Alert>
        ) : null}

        <Stack gap="xs">
          {filteredRows.map((row) => (
            <SearchResultSection
              key={row.plugin.id}
              row={row}
              pinned={pinnedPluginIds.includes(row.plugin.id)}
              openingKey={openingKey}
              onOpen={(resultRow, novel) => {
                void handleOpenNovel(resultRow, novel);
              }}
              onMore={openPluginResults}
              onOpenWebView={(plugin) => openSiteBrowser(plugin.site)}
              onRetry={retryFailed}
            />
          ))}
        </Stack>
      </section>
    </div>
  );
}
