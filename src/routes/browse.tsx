import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  ActionIcon,
  Anchor,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Modal,
  MultiSelect,
  Stack,
  Tabs,
  Text,
  TextInput,
} from "@mantine/core";
import {
  CheckGlyph,
  ClockGlyph,
  ExternalLinkGlyph,
  PinGlyph,
  PlusGlyph,
  RefreshGlyph,
  RepositoryGlyph,
  SourceGlyph,
  TrashGlyph,
} from "../components/ActionGlyphs";
import { PageFrame, PageHeader, StateView } from "../components/AppFrame";
import {
  ConsoleChip,
  ConsolePanel,
  ConsoleSectionHeader,
  ConsoleStatusDot,
  ConsoleStatusStrip,
} from "../components/ConsolePrimitives";
import { useSiteBrowserStore } from "../store/site-browser";
import {
  getCachedRepoIndex,
  setCachedRepoIndex,
} from "../db/queries/repo-index-cache";
import {
  formatPluginLanguageForLocale,
  useTranslation,
  type AppLocale,
} from "../i18n";
import {
  addRepository,
  listRepositories,
  removeRepository,
  type PluginRepository,
} from "../db/queries/repository";
import { isTauriRuntime } from "../lib/tauri-runtime";
import { PluginSearchSection } from "./global-search";
import { isValidPluginItem, pluginManager } from "../lib/plugins/manager";
import type { Plugin, PluginItem } from "../lib/plugins/types";
import { useBrowseStore } from "../store/browse";

const REPO_QUERY_KEY = ["repository", "list"] as const;
const AVAILABLE_QUERY_KEY = ["plugin", "available"] as const;
const INSTALLED_QUERY_KEY = ["plugin", "installed"] as const;

interface AvailableEntry {
  item: PluginItem;
  repoUrl: string;
}

interface RepoFetchFailure {
  repoUrl: string;
  message: string;
}

interface AvailableResult {
  entries: AvailableEntry[];
  failures: RepoFetchFailure[];
}

interface BrowsePageProps {
  active?: boolean;
  query?: string;
}

interface LanguageOption {
  value: string;
  label: string;
}

function makeLanguageOptions(
  plugins: readonly PluginItem[],
  selectedLanguages: readonly string[],
  locale: AppLocale,
): LanguageOption[] {
  const languages = [
    ...selectedLanguages.filter(isNonEmptyString),
    ...plugins.map((p) => p.lang).filter(isNonEmptyString),
  ];
  return [...new Set(languages)]
    .sort((a, b) =>
      formatPluginLanguageForLocale(locale, a).localeCompare(
        formatPluginLanguageForLocale(locale, b),
      ),
    )
    .map((lang) => ({
      value: lang,
      label: `${formatPluginLanguageForLocale(locale, lang)} (${lang})`,
    }));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function filterByLanguage<T extends PluginItem>(
  plugins: readonly T[],
  languages: readonly string[],
): T[] {
  if (languages.length === 0) return [...plugins];
  return plugins.filter(
    (plugin) =>
      isNonEmptyString(plugin.lang) && languages.includes(plugin.lang),
  );
}

function sortByName<T extends PluginItem>(plugins: readonly T[]): T[] {
  return [...plugins].sort((a, b) =>
    (a.name ?? a.id).localeCompare(b.name ?? b.id),
  );
}

/**
 * Cache-first index loader.
 *
 * `forceRefresh=false` (default Browse mount, query refetch):
 *   Per repo, return the cached items if any. If no cache row
 *   exists yet for a repo (first-ever load), do a single network
 *   fetch + write the cache so it's instant from then on. Already-
 *   cached repos NEVER hit the network on tab open.
 *
 * `forceRefresh=true` (the Refresh button):
 *   Always re-fetch from network and overwrite the cache.
 */
async function fetchAllAvailable(
  repos: readonly PluginRepository[],
  forceRefresh: boolean,
): Promise<AvailableResult> {
  const entries: AvailableEntry[] = [];
  const failures: RepoFetchFailure[] = [];
  for (const repo of repos) {
    try {
      let items: PluginItem[] | null = null;
      if (!forceRefresh) {
        const cached = await getCachedRepoIndex(repo.url);
        if (cached) items = cached.items.filter(isValidPluginItem);
      }
      if (items === null) {
        items = await pluginManager.fetchRepository(repo.url);
        await setCachedRepoIndex(repo.url, items);
      }
      for (const item of items) {
        entries.push({ item, repoUrl: repo.url });
      }
    } catch (error) {
      failures.push({
        repoUrl: repo.url,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { entries, failures };
}

export function BrowsePage({ active = true, query: q = "" }: BrowsePageProps) {
  const { locale, t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const repos = useQuery({
    queryKey: REPO_QUERY_KEY,
    queryFn: listRepositories,
  });

  const installed = useQuery({
    queryKey: INSTALLED_QUERY_KEY,
    queryFn: async () => {
      if (isTauriRuntime()) {
        await pluginManager.loadInstalledFromDb();
      }
      return pluginManager.list();
    },
    staleTime: 0,
  });

  const [forceRefreshNext, setForceRefreshNext] = useState(false);

  const available = useQuery({
    queryKey: AVAILABLE_QUERY_KEY,
    queryFn: async () => {
      const force = forceRefreshNext;
      setForceRefreshNext(false);
      return fetchAllAvailable(repos.data ?? [], force);
    },
    enabled: !!repos.data && repos.data.length > 0,
  });

  const pendingRepoUrl = useBrowseStore((s) => s.pendingRepoUrl);
  const clearPendingRepoUrl = useBrowseStore(
    (s) => s.clearPendingRepoUrl,
  );
  const pluginLanguageFilter = useBrowseStore(
    (s) => s.pluginLanguageFilter,
  );
  const setPluginLanguageFilter = useBrowseStore(
    (s) => s.setPluginLanguageFilter,
  );
  const pinnedPluginIds = useBrowseStore((s) => s.pinnedPluginIds);
  const togglePinnedPlugin = useBrowseStore((s) => s.togglePinnedPlugin);
  const lastUsedPluginId = useBrowseStore((s) => s.lastUsedPluginId);
  const setLastUsedPluginId = useBrowseStore(
    (s) => s.setLastUsedPluginId,
  );
  const siteBrowserVisible = useSiteBrowserStore((s) => s.visible);
  const siteBrowserUrl = useSiteBrowserStore((s) => s.currentUrl);

  const [addOpen, setAddOpen] = useState(false);
  const [url, setUrl] = useState("");

  const navigateToSource = (pluginId: string) =>
    navigate({
      to: "/source",
      search: { pluginId, query: "" },
    });

  const installedPlugins = installed.data ?? [];
  const activeRepository = repos.data?.[0] ?? null;
  const hasRepository = activeRepository !== null;
  const availableEntries = hasRepository
    ? (available.data?.entries ?? [])
    : [];
  const languageOptions = useMemo(
    () =>
      makeLanguageOptions(
        [
          ...installedPlugins,
          ...availableEntries.map((entry) => entry.item),
        ],
        pluginLanguageFilter,
        locale,
      ),
    [availableEntries, installedPlugins, pluginLanguageFilter, locale],
  );
  const filteredInstalledPlugins = useMemo(
    () => filterByLanguage(installedPlugins, pluginLanguageFilter),
    [installedPlugins, pluginLanguageFilter],
  );
  const filteredAvailableEntries = useMemo(
    () =>
      pluginLanguageFilter.length === 0
        ? availableEntries
        : availableEntries.filter(({ item }) =>
            pluginLanguageFilter.includes(item.lang),
          ),
    [availableEntries, pluginLanguageFilter],
  );
  const installedIds = useMemo(
    () => new Set(installed.data?.map((p) => p.id) ?? []),
    [installed.data],
  );
  const pinnedCount = installedPlugins.filter((plugin) =>
    pinnedPluginIds.includes(plugin.id),
  ).length;
  const availableFailures = hasRepository
    ? (available.data?.failures ?? [])
    : [];
  const failureCount = availableFailures.length;

  // Deep-link entry: pre-fill the URL and open the modal.
  useEffect(() => {
    if (pendingRepoUrl !== null) {
      setUrl(pendingRepoUrl);
      setAddOpen(true);
      clearPendingRepoUrl();
    }
  }, [pendingRepoUrl, clearPendingRepoUrl]);

  const addRepoMutation = useMutation({
    mutationFn: async () => {
      const trimmed = url.trim();
      if (trimmed === "") return;
      await addRepository({ url: trimmed });
    },
    onSuccess: () => {
      queryClient.setQueryData<AvailableResult>(AVAILABLE_QUERY_KEY, {
        entries: [],
        failures: [],
      });
      queryClient.invalidateQueries({ queryKey: ["repository"] });
      queryClient.invalidateQueries({ queryKey: AVAILABLE_QUERY_KEY });
      setUrl("");
      setAddOpen(false);
    },
  });

  const removeRepoMutation = useMutation({
    mutationFn: async (id: number) => removeRepository(id),
    onSuccess: () => {
      queryClient.setQueryData<AvailableResult>(AVAILABLE_QUERY_KEY, {
        entries: [],
        failures: [],
      });
      queryClient.invalidateQueries({ queryKey: ["repository"] });
      queryClient.invalidateQueries({ queryKey: AVAILABLE_QUERY_KEY });
    },
  });

  const installMutation = useMutation({
    mutationFn: async (item: PluginItem): Promise<Plugin> =>
      pluginManager.installPlugin(item),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["plugin"] });
    },
  });

  const uninstallMutation = useMutation({
    mutationFn: async (id: string): Promise<void> => {
      pluginManager.uninstallPlugin(id);
    },
    onMutate: (id) => {
      if (lastUsedPluginId === id) {
        setLastUsedPluginId(null);
      }
      if (pinnedPluginIds.includes(id)) {
        togglePinnedPlugin(id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["plugin"] });
    },
  });

  return (
    <PageFrame size="wide" className="lnr-browse-page">
      <PageHeader
        title={t("browse.title")}
        description={t("browse.description")}
      />

      <Tabs
        defaultValue="search"
        keepMounted
        className="lnr-browse-tabs"
      >
        <Tabs.List grow className="lnr-browse-tab-list">
          <Tabs.Tab
            value="search"
            rightSection={
              <Badge size="xs">{filteredInstalledPlugins.length}</Badge>
            }
          >
            {t("browse.tab.search")}
          </Tabs.Tab>
          <Tabs.Tab
            value="sources"
            rightSection={
              <Badge size="xs">{installedPlugins.length}</Badge>
            }
          >
            {t("browse.tab.sources")}
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="search" className="lnr-browse-tab-panel">
          <div className="lnr-browse-tab-stack">
            <ConsolePanel className="lnr-browse-search-panel">
              <PluginSearchSection
                installedPlugins={filteredInstalledPlugins}
                query={q}
                onSearch={(nextQuery) => {
                  void navigate({
                    to: "/browse",
                    search: { q: nextQuery },
                  });
                }}
              />
            </ConsolePanel>
          </div>
        </Tabs.Panel>

        <Tabs.Panel value="sources" className="lnr-browse-tab-panel">
          <div className="lnr-browse-tab-stack">
            <PluginSettingsSection
              languageOptions={languageOptions}
              selectedLanguages={pluginLanguageFilter}
              onLanguageChange={setPluginLanguageFilter}
            />

            <ConsolePanel className="lnr-browse-panel" title={t("browse.sourceActions")}>
              <Group p="sm" gap="xs" wrap="wrap">
                <ActionIcon
                  className="lnr-action-icon"
                  size="md"
                  variant="light"
                  aria-label={
                    hasRepository
                      ? t("browse.changeRepository")
                      : t("browse.setRepository")
                  }
                  title={
                    hasRepository
                      ? t("browse.changeRepository")
                      : t("browse.setRepository")
                  }
                  onClick={() => {
                    setUrl(activeRepository?.url ?? "");
                    setAddOpen(true);
                  }}
                >
                  <RepositoryGlyph />
                </ActionIcon>
                <ActionIcon
                  className="lnr-action-icon"
                  size="md"
                  variant="subtle"
                  aria-label={t("common.refresh")}
                  title={t("common.refresh")}
                  loading={available.isFetching}
                  onClick={() => {
                    setForceRefreshNext(true);
                    void queryClient.invalidateQueries({
                      queryKey: AVAILABLE_QUERY_KEY,
                    });
                  }}
                  disabled={!hasRepository}
                >
                  <RefreshGlyph />
                </ActionIcon>
              </Group>
            </ConsolePanel>

            <InstalledSection
              plugins={filteredInstalledPlugins}
              locale={locale}
              onUninstall={(id) => uninstallMutation.mutate(id)}
              uninstalling={uninstallMutation.isPending}
              pinnedPluginIds={pinnedPluginIds}
              lastUsedPluginId={lastUsedPluginId}
              onTogglePin={togglePinnedPlugin}
              onOpenSource={(plugin) => {
                setLastUsedPluginId(plugin.id);
                void navigateToSource(plugin.id);
              }}
            />

            <AvailableSection
              query={available}
              entries={filteredAvailableEntries}
              locale={locale}
              hasRepository={hasRepository}
              installedIds={installedIds}
              onInstall={(item) => installMutation.mutate(item)}
              installing={installMutation.isPending}
              failures={availableFailures}
            />

            <RepositoriesSection
              query={repos}
              onRemove={(id) => removeRepoMutation.mutate(id)}
              removing={removeRepoMutation.isPending}
            />

            <FetchContextSection
              visible={siteBrowserVisible}
              currentUrl={siteBrowserUrl}
            />
          </div>
        </Tabs.Panel>
      </Tabs>

      <ConsoleStatusStrip>
        <span>
          {hasRepository ? t("browse.repositoryConfigured") : t("browse.noRepository")}
        </span>
        <span>{t("browse.installedSourcesCount", { count: installedPlugins.length })}</span>
        <span>{t("browse.pinnedCount", { count: pinnedCount })}</span>
        <span>{t("browse.availableCount", { count: filteredAvailableEntries.length })}</span>
        <span>{t("browse.repositoryFetchFailuresCount", { count: failureCount })}</span>
      </ConsoleStatusStrip>

      <Modal
        opened={active && addOpen}
        onClose={() => {
          setAddOpen(false);
          addRepoMutation.reset();
        }}
        title={t("browse.setRepository")}
      >
        <Stack gap="sm">
          <TextInput
            label={t("browse.repositoryUrl")}
            placeholder="https://example.com/plugins.json"
            value={url}
            onChange={(event) => setUrl(event.currentTarget.value)}
            autoFocus
          />
          {addRepoMutation.error && (
            <StateView
              color="red"
              title={t("common.saveFailed")}
              message={
                addRepoMutation.error instanceof Error
                  ? addRepoMutation.error.message
                  : String(addRepoMutation.error)
              }
            />
          )}
          <Group justify="flex-end">
            <Button
              variant="subtle"
              onClick={() => {
                setAddOpen(false);
                addRepoMutation.reset();
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              loading={addRepoMutation.isPending}
              disabled={url.trim() === ""}
              onClick={() => addRepoMutation.mutate()}
            >
              {t("common.save")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </PageFrame>
  );
}

interface FetchContextSectionProps {
  visible: boolean;
  currentUrl: string | null;
}

function FetchContextSection({
  visible,
  currentUrl,
}: FetchContextSectionProps) {
  const { t } = useTranslation();

  return (
    <ConsolePanel className="lnr-browse-panel" title={t("browse.fetchContext.title")}>
      <Stack gap="sm" p="sm">
        <Group gap="xs" wrap="wrap">
          <ConsoleStatusDot
            status={visible ? "done" : "idle"}
            label={
              visible
                ? t("browse.fetchContext.webviewOpen")
                : t("browse.fetchContext.webviewIdle")
            }
          />
          <ConsoleChip>{t("browse.fetchContext.repositoryHttp")}</ConsoleChip>
          <ConsoleChip tone="accent">
            {t("browse.fetchContext.scraperWebView")}
          </ConsoleChip>
          <ConsoleChip tone="warning">
            {t("browse.fetchContext.cloudflareReady")}
          </ConsoleChip>
        </Group>
        {currentUrl ? (
          <Box style={{ minWidth: 0 }}>
            <Text className="lnr-console-kicker">
              {t("browse.fetchContext.preparedSite")}
            </Text>
            <Anchor
              size="sm"
              truncate
              onClick={(event) => {
                event.preventDefault();
                openSite(currentUrl);
              }}
            >
              {currentUrl}
            </Anchor>
          </Box>
        ) : (
          <Text size="sm" c="dimmed">
            {t("browse.fetchContext.empty")}
          </Text>
        )}
      </Stack>
    </ConsolePanel>
  );
}

interface RepositoriesSectionProps {
  query: ReturnType<typeof useQuery<PluginRepository[]>>;
  onRemove: (id: number) => void;
  removing: boolean;
}

interface PluginSettingsSectionProps {
  languageOptions: readonly LanguageOption[];
  selectedLanguages: string[];
  onLanguageChange: (languages: string[]) => void;
}

function PluginSettingsSection({
  languageOptions,
  selectedLanguages,
  onLanguageChange,
}: PluginSettingsSectionProps) {
  const { t } = useTranslation();

  return (
    <ConsolePanel className="lnr-browse-panel" title={t("browse.pluginFilters.title")}>
      <div className="lnr-browse-settings-grid">
        <MultiSelect
          label={t("browse.pluginLanguages.label")}
          description={t("browse.pluginLanguages.description")}
          data={languageOptions}
          value={selectedLanguages}
          onChange={onLanguageChange}
          placeholder={t("browse.pluginLanguages.placeholder")}
          searchable
          clearable
        />
      </div>
      <ConsoleStatusStrip className="lnr-browse-panel-strip">
        <span>
          {selectedLanguages.length === 0
            ? t("browse.allLanguages")
            : t("browse.languageCount", { count: selectedLanguages.length })}
        </span>
      </ConsoleStatusStrip>
    </ConsolePanel>
  );
}

function RepositoriesSection({
  query,
  onRemove,
  removing,
}: RepositoriesSectionProps) {
  const { t } = useTranslation();
  const repository = query.data?.[0] ?? null;

  return (
    <ConsolePanel className="lnr-browse-panel" title={t("browse.repository.title")}>
      <Stack gap="xs" p="sm">
        <Group justify="space-between" align="center">
          <ConsoleStatusDot
            status="active"
            label={t("browse.repository.singleCacheFirstIndex")}
          />
        </Group>
        {query.isLoading ? (
          <StateView
            title={
              <Group gap="sm">
                <Loader size="sm" />
                {t("common.loading")}
              </Group>
            }
          />
        ) : query.error ? (
          <StateView
            color="red"
            title={t("library.databaseError")}
            message={
              query.error instanceof Error
                ? query.error.message
                : String(query.error)
            }
          />
        ) : repository ? (
          <Stack gap={6}>
            <div key={repository.id} className="lnr-browse-repo-row">
              <Group justify="space-between" align="flex-start" wrap="wrap">
                <Box style={{ minWidth: 0, flex: "1 1 18rem" }}>
                  <Group gap="xs" wrap="wrap">
                    <span
                      className="lnr-icon-state"
                      role="img"
                      aria-label={t("browse.repository.badge")}
                      title={t("browse.repository.badge")}
                    >
                      <RepositoryGlyph />
                    </span>
                    <Text size="sm" fw={500} truncate>
                      {repository.name ?? repository.url}
                    </Text>
                  </Group>
                  {repository.name ? (
                    <Text size="xs" c="dimmed" truncate>
                      {repository.url}
                    </Text>
                  ) : null}
                </Box>
                <ActionIcon
                  className="lnr-action-icon lnr-action-icon--danger"
                  size="sm"
                  color="red"
                  variant="subtle"
                  loading={removing}
                  aria-label={t("common.remove")}
                  title={t("common.remove")}
                  onClick={() => onRemove(repository.id)}
                >
                  <TrashGlyph />
                </ActionIcon>
              </Group>
            </div>
          </Stack>
        ) : (
          <StateView
            color="blue"
            title={t("browse.repository.emptyTitle")}
            message={t("browse.repository.emptyMessage")}
          />
        )}
      </Stack>
    </ConsolePanel>
  );
}

interface InstalledSectionProps {
  plugins: Plugin[];
  locale: AppLocale;
  onUninstall: (id: string) => void;
  uninstalling: boolean;
  pinnedPluginIds: readonly string[];
  lastUsedPluginId: string | null;
  onTogglePin: (id: string) => void;
  onOpenSource: (plugin: Plugin) => void;
}

/**
 * Open the plugin's site in the in-app browser overlay. The
 * persistent scraper WebView owns browser cache and cookies, and
 * plugin-owned fetches prepare this origin before requesting data.
 */
function openSite(url: string): void {
  useSiteBrowserStore.getState().openAt(url);
}

interface PluginRowProps {
  plugin: Plugin;
  locale: AppLocale;
  pinned: boolean;
  lastUsed: boolean;
  onTogglePin: (id: string) => void;
  onOpenSource: (plugin: Plugin) => void;
  onUninstall: (id: string) => void;
  uninstalling: boolean;
}

function PluginRow({
  plugin,
  locale,
  pinned,
  lastUsed,
  onTogglePin,
  onOpenSource,
  onUninstall,
  uninstalling,
}: PluginRowProps) {
  const { t } = useTranslation();

  return (
    <div key={plugin.id} className="lnr-browse-plugin-row">
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
        <Box style={{ minWidth: 0, flex: "1 1 18rem" }}>
          <Group gap="xs" wrap="wrap">
            <Text
              size="sm"
              fw={600}
              truncate
              style={{ maxWidth: "min(100%, 28rem)" }}
            >
              {plugin.name}
            </Text>
            <ConsoleChip>
              {formatPluginLanguageForLocale(locale, plugin.lang)}
            </ConsoleChip>
            <ConsoleChip>
              v{plugin.version}
            </ConsoleChip>
            {pinned ? (
              <span
                className="lnr-icon-state"
                data-active="true"
                role="img"
                aria-label={t("common.pinned")}
                title={t("common.pinned")}
              >
                <PinGlyph />
              </span>
            ) : null}
            {lastUsed ? (
              <span
                className="lnr-icon-state"
                data-tone="accent"
                role="img"
                aria-label={t("browse.lastUsed")}
                title={t("browse.lastUsed")}
              >
                <ClockGlyph />
              </span>
            ) : null}
          </Group>
          <Anchor
            size="xs"
            c="dimmed"
            truncate
            onClick={(event) => {
              event.preventDefault();
              openSite(plugin.site);
            }}
            title={t("common.openSiteInApp")}
          >
            {plugin.site}
          </Anchor>
        </Box>
        <Group className="lnr-action-strip" gap={4} wrap="nowrap" justify="flex-end">
          <ActionIcon
            className={`lnr-action-icon${pinned ? " lnr-action-icon--active" : ""}`}
            size="sm"
            variant="subtle"
            disabled={uninstalling}
            aria-label={`${t("common.source")}: ${plugin.name}`}
            title={t("common.source")}
            onClick={() => onOpenSource(plugin)}
          >
            <SourceGlyph />
          </ActionIcon>
          <ActionIcon
            className="lnr-action-icon lnr-action-icon--danger"
            size="sm"
            variant={pinned ? "light" : "default"}
            disabled={uninstalling}
            aria-pressed={pinned}
            aria-label={`${pinned ? t("browse.unpin") : t("browse.pin")}: ${plugin.name}`}
            title={pinned ? t("browse.unpin") : t("browse.pin")}
            onClick={() => onTogglePin(plugin.id)}
          >
            <PinGlyph />
          </ActionIcon>
          <ActionIcon
            className="lnr-action-icon"
            size="sm"
            variant="default"
            disabled={uninstalling}
            aria-label={`${t("common.openSite")}: ${plugin.name}`}
            title={t("common.openSite")}
            onClick={() => openSite(plugin.site)}
          >
            <ExternalLinkGlyph />
          </ActionIcon>
          <ActionIcon
            className="lnr-action-icon"
            size="sm"
            color="red"
            variant="subtle"
            loading={uninstalling}
            aria-label={`${t("browse.uninstall")}: ${plugin.name}`}
            title={t("browse.uninstall")}
            onClick={() => onUninstall(plugin.id)}
          >
            <TrashGlyph />
          </ActionIcon>
        </Group>
      </Group>
    </div>
  );
}

function InstalledSection({
  plugins,
  locale,
  onUninstall,
  uninstalling,
  pinnedPluginIds,
  lastUsedPluginId,
  onTogglePin,
  onOpenSource,
}: InstalledSectionProps) {
  const { t } = useTranslation();
  const sortedPlugins = sortByName(plugins);
  const pinnedPlugins = sortedPlugins.filter((plugin) =>
    pinnedPluginIds.includes(plugin.id),
  );
  const unpinnedPlugins = sortedPlugins.filter(
    (plugin) => !pinnedPluginIds.includes(plugin.id),
  );
  const lastUsedPlugin = unpinnedPlugins.find(
    (plugin) => plugin.id === lastUsedPluginId,
  );

  return (
    <ConsolePanel
      className="lnr-browse-panel"
      title={t("browse.installedSources.title")}
    >
      <Stack gap="sm" p="sm">
      <ConsoleSectionHeader
        title={t("browse.sourcesHeader")}
        count={plugins.length}
        actions={
          <span
            className="lnr-icon-count"
            aria-label={t("browse.pinnedCount", { count: pinnedPlugins.length })}
            title={t("browse.pinnedCount", { count: pinnedPlugins.length })}
          >
            <PinGlyph />
            <span>{pinnedPlugins.length}</span>
          </span>
        }
      />
      {plugins.length > 0 ? (
        <Stack gap="sm">
          {pinnedPlugins.length > 0 ? (
            <Stack gap={6}>
              <Text size="xs" fw={600} c="dimmed">
                {t("browse.pinnedPlugins")}
              </Text>
              {pinnedPlugins.map((plugin) => (
                <PluginRow
                  key={plugin.id}
                  plugin={plugin}
                  locale={locale}
                  pinned
                  lastUsed={plugin.id === lastUsedPluginId}
                  onTogglePin={onTogglePin}
                  onOpenSource={onOpenSource}
                  onUninstall={onUninstall}
                  uninstalling={uninstalling}
                />
              ))}
            </Stack>
          ) : null}

          {lastUsedPlugin ? (
            <Stack gap={6}>
              <Text size="xs" fw={600} c="dimmed">
                {t("browse.lastUsed")}
              </Text>
              <PluginRow
                plugin={lastUsedPlugin}
                locale={locale}
                pinned={false}
                lastUsed
                onTogglePin={onTogglePin}
                onOpenSource={onOpenSource}
                onUninstall={onUninstall}
                uninstalling={uninstalling}
              />
            </Stack>
          ) : null}

          <Stack gap={6}>
            <Text size="xs" fw={600} c="dimmed">
              {t("browse.allInstalledPlugins")}
            </Text>
            {unpinnedPlugins.map((plugin) => (
              <PluginRow
                key={plugin.id}
                plugin={plugin}
                locale={locale}
                pinned={false}
                lastUsed={plugin.id === lastUsedPluginId}
                onTogglePin={onTogglePin}
                onOpenSource={onOpenSource}
                onUninstall={onUninstall}
                uninstalling={uninstalling}
              />
            ))}
          </Stack>
        </Stack>
      ) : (
        <StateView
          color="blue"
          title={t("browse.noInstalledPlugins.title")}
          message={t("browse.noInstalledPlugins.message")}
        />
      )}
      </Stack>
    </ConsolePanel>
  );
}

interface AvailableSectionProps {
  query: ReturnType<typeof useQuery<AvailableResult>>;
  entries: readonly AvailableEntry[];
  locale: AppLocale;
  hasRepository: boolean;
  installedIds: ReadonlySet<string>;
  onInstall: (item: PluginItem) => void;
  installing: boolean;
  failures: readonly RepoFetchFailure[];
}

function AvailableSection({
  query,
  entries,
  locale,
  hasRepository,
  installedIds,
  onInstall,
  installing,
  failures,
}: AvailableSectionProps) {
  const { t } = useTranslation();

  return (
    <ConsolePanel
      className="lnr-browse-panel"
      title={t("browse.availableSourcePlugins.title")}
    >
      <Stack gap="sm" p="sm">
        <ConsoleSectionHeader
          title={t("browse.repositoryIndex")}
          count={entries.length}
          actions={
            !hasRepository ? (
              <span
                className="lnr-icon-state"
                role="img"
                aria-label={t("browse.notSet")}
                title={t("browse.notSet")}
              >
                <RepositoryGlyph />
              </span>
            ) : failures.length > 0 ? (
              <span
                className="lnr-icon-count"
                data-tone="error"
                aria-label={t("globalSearch.summary.failed", { count: failures.length })}
                title={t("globalSearch.summary.failed", { count: failures.length })}
              >
                <RefreshGlyph />
                <span>{failures.length}</span>
              </span>
            ) : (
              <span
                className="lnr-icon-state"
                data-tone="success"
                role="img"
                aria-label={t("common.ready")}
                title={t("common.ready")}
              >
                <CheckGlyph />
              </span>
            )
          }
        />
        {failures.length > 0 && (
          <Stack gap={4}>
            {failures.map((failure) => (
              <StateView
                key={failure.repoUrl}
                color="red"
                title={t("browse.couldNotFetchRepo", {
                  url: failure.repoUrl,
                })}
                message={failure.message}
              />
            ))}
          </Stack>
        )}
        {query.isLoading || query.isFetching ? (
          <StateView
            title={
              <Group gap="sm">
                <Loader size="sm" />
                {t("browse.fetchingRepositoryIndex")}
              </Group>
            }
          />
        ) : query.error ? (
          <StateView
            color="red"
            title={t("browse.repositoryFetchError")}
            message={
              query.error instanceof Error
                ? query.error.message
                : String(query.error)
            }
          />
        ) : entries.length > 0 ? (
          <Stack gap={6}>
            {entries.map(({ item, repoUrl }) => {
              const isInstalled = installedIds.has(item.id);
              return (
                <AvailablePluginRow
                  key={`${repoUrl}::${item.id}`}
                  item={item}
                  locale={locale}
                  repoUrl={repoUrl}
                  isInstalled={isInstalled}
                  installing={installing}
                  onInstall={onInstall}
                />
              );
            })}
          </Stack>
        ) : (
          <StateView
            color="blue"
            title={t("browse.noAvailablePlugins.title")}
            message={
              !hasRepository
                ? t("browse.noAvailablePlugins.noRepository")
                : failures.length > 0
                  ? t("browse.noAvailablePlugins.failure")
                  : t("browse.noAvailablePlugins.empty")
            }
          />
        )}
      </Stack>
    </ConsolePanel>
  );
}

interface AvailablePluginRowProps {
  item: PluginItem;
  locale: AppLocale;
  repoUrl: string;
  isInstalled: boolean;
  installing: boolean;
  onInstall: (item: PluginItem) => void;
}

function AvailablePluginRow({
  item,
  locale,
  repoUrl,
  isInstalled,
  installing,
  onInstall,
}: AvailablePluginRowProps) {
  const { t } = useTranslation();

  return (
    <div className="lnr-browse-plugin-row">
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
        <Box style={{ minWidth: 0, flex: "1 1 18rem" }}>
          <Group gap="xs" wrap="wrap">
            <Text
              size="sm"
              fw={600}
              truncate
              style={{ maxWidth: "min(100%, 28rem)" }}
            >
              {item.name}
            </Text>
            <ConsoleChip>
              {formatPluginLanguageForLocale(locale, item.lang)}
            </ConsoleChip>
            <ConsoleChip>
              v{item.version}
            </ConsoleChip>
            {isInstalled ? (
              <span
                className="lnr-icon-state"
                data-tone="success"
                role="img"
                aria-label={t("common.installed")}
                title={t("common.installed")}
              >
                <CheckGlyph />
              </span>
            ) : null}
          </Group>
          <Anchor
            size="xs"
            c="dimmed"
            truncate
            onClick={(event) => {
              event.preventDefault();
              openSite(item.site);
            }}
            title={t("common.openSiteInApp")}
          >
            {item.site}
          </Anchor>
          <Text size="xs" c="dimmed" truncate>
            {t("browse.repositoryLabel", { url: repoUrl })}
          </Text>
        </Box>
        <Group className="lnr-action-strip" gap={4} wrap="nowrap" justify="flex-end">
          <ActionIcon
            className="lnr-action-icon"
            size="sm"
            variant="default"
            disabled={installing}
            aria-label={`${t("common.openSite")}: ${item.name}`}
            title={t("common.openSite")}
            onClick={() => openSite(item.site)}
          >
            <ExternalLinkGlyph />
          </ActionIcon>
          <ActionIcon
            className="lnr-action-icon"
            size="sm"
            variant="light"
            disabled={isInstalled}
            loading={installing && !isInstalled}
            aria-label={`${isInstalled ? t("common.installed") : t("common.install")}: ${item.name}`}
            title={isInstalled ? t("common.installed") : t("common.install")}
            onClick={() => onInstall(item)}
          >
            {isInstalled ? <CheckGlyph /> : <PlusGlyph />}
          </ActionIcon>
        </Group>
      </Group>
    </div>
  );
}
