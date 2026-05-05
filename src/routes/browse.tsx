import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Anchor,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Modal,
  MultiSelect,
  NumberInput,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
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
  addRepository,
  listRepositories,
  removeRepository,
  type PluginRepository,
} from "../db/queries/repository";
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

function formatPluginLanguage(lang: string): string {
  if (lang === "multi") return "Multi";
  try {
    const displayNames = new Intl.DisplayNames(["en"], {
      type: "language",
    });
    return displayNames.of(lang) ?? lang;
  } catch {
    return lang;
  }
}

function makeLanguageOptions(
  plugins: readonly PluginItem[],
  selectedLanguages: readonly string[],
): LanguageOption[] {
  const languages = [
    ...selectedLanguages.filter(isNonEmptyString),
    ...plugins.map((p) => p.lang).filter(isNonEmptyString),
  ];
  return [...new Set(languages)]
    .sort((a, b) =>
      formatPluginLanguage(a).localeCompare(formatPluginLanguage(b)),
    )
    .map((lang) => ({
      value: lang,
      label: `${formatPluginLanguage(lang)} (${lang})`,
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
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const repos = useQuery({
    queryKey: REPO_QUERY_KEY,
    queryFn: listRepositories,
  });

  const installed = useQuery({
    queryKey: INSTALLED_QUERY_KEY,
    queryFn: () => Promise.resolve(pluginManager.list()),
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
  const globalSearchConcurrency = useBrowseStore(
    (s) => s.globalSearchConcurrency,
  );
  const setGlobalSearchConcurrency = useBrowseStore(
    (s) => s.setGlobalSearchConcurrency,
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
  const availableEntries = available.data?.entries ?? [];
  const languageOptions = useMemo(
    () =>
      makeLanguageOptions(
        [
          ...installedPlugins,
          ...availableEntries.map((entry) => entry.item),
        ],
        pluginLanguageFilter,
      ),
    [availableEntries, installedPlugins, pluginLanguageFilter],
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
  const pinnedCount = filteredInstalledPlugins.filter((plugin) =>
    pinnedPluginIds.includes(plugin.id),
  ).length;
  const repositoryCount = repos.data?.length ?? 0;
  const failureCount = available.data?.failures.length ?? 0;

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
      queryClient.invalidateQueries({ queryKey: ["repository"] });
      queryClient.invalidateQueries({ queryKey: AVAILABLE_QUERY_KEY });
      setUrl("");
      setAddOpen(false);
    },
  });

  const removeRepoMutation = useMutation({
    mutationFn: async (id: number) => removeRepository(id),
    onSuccess: () => {
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
        title="Browse"
        description="Manage source repositories, narrow global search scope, and open source catalogs."
        actions={
          <>
            <Badge variant="light">{filteredInstalledPlugins.length} sources</Badge>
            <Button
              size="xs"
              variant="light"
              onClick={() => setAddOpen(true)}
            >
              + Add repository
            </Button>
            <Button
              size="xs"
              variant="subtle"
              loading={available.isFetching}
              onClick={() => {
                setForceRefreshNext(true);
                void queryClient.invalidateQueries({
                  queryKey: AVAILABLE_QUERY_KEY,
                });
              }}
              disabled={!repos.data || repos.data.length === 0}
            >
              Refresh
            </Button>
          </>
        }
      />

      <div className="lnr-browse-workbench">
        <aside className="lnr-browse-sidebar">
          <InstalledSection
            plugins={filteredInstalledPlugins}
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

          <RepositoriesSection
            query={repos}
            onRemove={(id) => removeRepoMutation.mutate(id)}
            removing={removeRepoMutation.isPending}
          />

          <FetchContextSection
            visible={siteBrowserVisible}
            currentUrl={siteBrowserUrl}
          />
        </aside>

        <main className="lnr-browse-content">
          <ConsolePanel className="lnr-browse-search-panel">
            <PluginSearchSection
              query={q}
              onSearch={(nextQuery) => {
                void navigate({
                  to: "/browse",
                  search: { q: nextQuery },
                });
              }}
            />
          </ConsolePanel>

          <PluginSettingsSection
            languageOptions={languageOptions}
            selectedLanguages={pluginLanguageFilter}
            onLanguageChange={setPluginLanguageFilter}
            globalSearchConcurrency={globalSearchConcurrency}
            onGlobalSearchConcurrencyChange={setGlobalSearchConcurrency}
          />

          <AvailableSection
            query={available}
            entries={filteredAvailableEntries}
            installedIds={installedIds}
            onInstall={(item) => installMutation.mutate(item)}
            installing={installMutation.isPending}
            failures={available.data?.failures ?? []}
          />
        </main>
      </div>

      <ConsoleStatusStrip>
        <span>{repositoryCount} repositories</span>
        <span>{filteredInstalledPlugins.length} installed sources</span>
        <span>{pinnedCount} pinned</span>
        <span>{filteredAvailableEntries.length} available</span>
        <span>{failureCount} repository failures</span>
      </ConsoleStatusStrip>

      <Modal
        opened={active && addOpen}
        onClose={() => {
          setAddOpen(false);
          addRepoMutation.reset();
        }}
        title="Add repository"
      >
        <Stack gap="sm">
          <TextInput
            label="Repository URL"
            placeholder="https://example.com/plugins.json"
            value={url}
            onChange={(event) => setUrl(event.currentTarget.value)}
            autoFocus
          />
          {addRepoMutation.error && (
            <StateView
              color="red"
              title="Add failed"
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
              Cancel
            </Button>
            <Button
              loading={addRepoMutation.isPending}
              disabled={url.trim() === ""}
              onClick={() => addRepoMutation.mutate()}
            >
              Add
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
  return (
    <ConsolePanel className="lnr-browse-panel" title="Fetch context">
      <Stack gap="sm" p="sm">
        <Group gap="xs" wrap="wrap">
          <ConsoleStatusDot
            status={visible ? "done" : "idle"}
            label={visible ? "WebView open" : "WebView idle"}
          />
          <ConsoleChip>Repository HTTP</ConsoleChip>
          <ConsoleChip tone="accent">Scraper WebView</ConsoleChip>
          <ConsoleChip tone="warning">Cloudflare-ready</ConsoleChip>
        </Group>
        {currentUrl ? (
          <Box style={{ minWidth: 0 }}>
            <Text className="lnr-console-kicker">Prepared site</Text>
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
            No plugin site is prepared yet.
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
  globalSearchConcurrency: number;
  onGlobalSearchConcurrencyChange: (concurrency: number) => void;
}

function PluginSettingsSection({
  languageOptions,
  selectedLanguages,
  onLanguageChange,
  globalSearchConcurrency,
  onGlobalSearchConcurrencyChange,
}: PluginSettingsSectionProps) {
  return (
    <ConsolePanel className="lnr-browse-panel" title="Search controls">
      <div className="lnr-browse-settings-grid">
        <MultiSelect
          label="Plugin languages"
          description="Filters installed, available, and global search plugin lists."
          data={languageOptions}
          value={selectedLanguages}
          onChange={onLanguageChange}
          placeholder="Select languages"
          searchable
          clearable
        />
        <NumberInput
          label="Global search concurrency"
          description="Number of plugins searched at the same time."
          value={globalSearchConcurrency}
          min={1}
          max={10}
          step={1}
          clampBehavior="strict"
          onChange={(value) => {
            if (typeof value === "number") {
              onGlobalSearchConcurrencyChange(value);
            }
          }}
        />
      </div>
      <ConsoleStatusStrip className="lnr-browse-panel-strip">
        <span>
          {selectedLanguages.length === 0
            ? "All languages"
            : `${selectedLanguages.length} languages`}
        </span>
        <span>{globalSearchConcurrency} concurrent searches</span>
      </ConsoleStatusStrip>
    </ConsolePanel>
  );
}

function RepositoriesSection({
  query,
  onRemove,
  removing,
}: RepositoriesSectionProps) {
  return (
    <ConsolePanel className="lnr-browse-panel" title="Repositories">
      <Stack gap="xs" p="sm">
        <Group justify="space-between" align="center">
          <ConsoleStatusDot status="active" label="Cache-first index" />
          {query.data ? <ConsoleChip>{query.data.length}</ConsoleChip> : null}
        </Group>
      {query.isLoading ? (
        <StateView
          title={
            <Group gap="sm">
              <Loader size="sm" />
              Loading...
            </Group>
          }
        />
      ) : query.error ? (
        <StateView
          color="red"
          title="Database error"
          message={
            query.error instanceof Error
              ? query.error.message
              : String(query.error)
          }
        />
      ) : query.data && query.data.length > 0 ? (
        <Stack gap={6}>
          {query.data.map((repo) => (
            <div key={repo.id} className="lnr-browse-repo-row">
              <Group justify="space-between" align="flex-start" wrap="wrap">
                <Box style={{ minWidth: 0, flex: "1 1 18rem" }}>
                  <Group gap="xs" wrap="wrap">
                    <Text size="sm" fw={500} truncate>
                      {repo.name ?? repo.url}
                    </Text>
                    <Badge size="xs" variant="outline">
                      Repository
                    </Badge>
                  </Group>
                  {repo.name ? (
                    <Text size="xs" c="dimmed" truncate>
                      {repo.url}
                    </Text>
                  ) : null}
                </Box>
                <Button
                  size="xs"
                  color="red"
                  variant="subtle"
                  loading={removing}
                  onClick={() => onRemove(repo.id)}
                >
                  Remove
                </Button>
              </Group>
            </div>
          ))}
        </Stack>
      ) : (
        <StateView
          color="blue"
          title="No repositories yet"
          message={
            <>
              Add a plugin repository URL, typically the lnreader-plugins
              index JSON. Deep-link <code>lnreader://repo/add?url=...</code>{" "}
              opens the Add dialog pre-filled.
            </>
          }
        />
      )}
      </Stack>
    </ConsolePanel>
  );
}

interface InstalledSectionProps {
  plugins: Plugin[];
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
  pinned: boolean;
  lastUsed: boolean;
  onTogglePin: (id: string) => void;
  onOpenSource: (plugin: Plugin) => void;
  onUninstall: (id: string) => void;
  uninstalling: boolean;
}

function PluginRow({
  plugin,
  pinned,
  lastUsed,
  onTogglePin,
  onOpenSource,
  onUninstall,
  uninstalling,
}: PluginRowProps) {
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
              {formatPluginLanguage(plugin.lang)}
            </ConsoleChip>
            <ConsoleChip>
              v{plugin.version}
            </ConsoleChip>
            {pinned ? (
              <ConsoleChip active>Pinned</ConsoleChip>
            ) : null}
            {lastUsed ? (
              <ConsoleChip tone="accent">Last used</ConsoleChip>
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
            title="Open site in app"
          >
            {plugin.site}
          </Anchor>
        </Box>
        <Group gap="xs" wrap="wrap" justify="flex-end">
          <Button
            size="xs"
            disabled={uninstalling}
            onClick={() => onOpenSource(plugin)}
          >
            Source
          </Button>
          <Button
            size="xs"
            variant={pinned ? "light" : "default"}
            disabled={uninstalling}
            onClick={() => onTogglePin(plugin.id)}
          >
            {pinned ? "Unpin" : "Pin"}
          </Button>
          <Button
            size="xs"
            variant="default"
            disabled={uninstalling}
            onClick={() => openSite(plugin.site)}
          >
            Open site
          </Button>
          <Button
            size="xs"
            color="red"
            variant="subtle"
            loading={uninstalling}
            onClick={() => onUninstall(plugin.id)}
          >
            Uninstall
          </Button>
        </Group>
      </Group>
    </div>
  );
}

function InstalledSection({
  plugins,
  onUninstall,
  uninstalling,
  pinnedPluginIds,
  lastUsedPluginId,
  onTogglePin,
  onOpenSource,
}: InstalledSectionProps) {
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
    <ConsolePanel className="lnr-browse-panel" title="Installed sources">
      <Stack gap="sm" p="sm">
      <ConsoleSectionHeader
        title="Sources"
        count={plugins.length}
        actions={<ConsoleChip active>{pinnedPlugins.length} pinned</ConsoleChip>}
      />
      {plugins.length > 0 ? (
        <Stack gap="sm">
          {pinnedPlugins.length > 0 ? (
            <Stack gap={6}>
              <Text size="xs" fw={600} c="dimmed">
                Pinned plugins
              </Text>
              {pinnedPlugins.map((plugin) => (
                <PluginRow
                  key={plugin.id}
                  plugin={plugin}
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
                Last used
              </Text>
              <PluginRow
                plugin={lastUsedPlugin}
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
              All installed plugins
            </Text>
            {unpinnedPlugins.map((plugin) => (
              <PluginRow
                key={plugin.id}
                plugin={plugin}
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
          title="No installed plugins"
          message="No installed plugins match the selected languages."
        />
      )}
      </Stack>
    </ConsolePanel>
  );
}

interface AvailableSectionProps {
  query: ReturnType<typeof useQuery<AvailableResult>>;
  entries: readonly AvailableEntry[];
  installedIds: ReadonlySet<string>;
  onInstall: (item: PluginItem) => void;
  installing: boolean;
  failures: readonly RepoFetchFailure[];
}

function AvailableSection({
  query,
  entries,
  installedIds,
  onInstall,
  installing,
  failures,
}: AvailableSectionProps) {
  return (
    <ConsolePanel className="lnr-browse-panel" title="Available source plugins">
      <Stack gap="sm" p="sm">
      <ConsoleSectionHeader
        title="Repository index"
        count={entries.length}
        actions={
          failures.length > 0 ? (
            <ConsoleChip tone="error">{failures.length} failed</ConsoleChip>
          ) : (
            <ConsoleChip tone="success">Ready</ConsoleChip>
          )
        }
      />
      {failures.length > 0 && (
        <Stack gap={4}>
          {failures.map((failure) => (
            <StateView
              key={failure.repoUrl}
              color="red"
              title={`Couldn't fetch ${failure.repoUrl}`}
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
              Fetching repository indexes...
            </Group>
          }
        />
      ) : query.error ? (
        <StateView
          color="red"
          title="Repository fetch error"
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
          title="No available plugins"
          message={
            !query.data
              ? "Add a repository to populate this list."
              : failures.length > 0
                ? "All configured repositories failed; see the errors above."
                : "No plugins exposed by the configured repositories."
          }
        />
      )}
      </Stack>
    </ConsolePanel>
  );
}

interface AvailablePluginRowProps {
  item: PluginItem;
  repoUrl: string;
  isInstalled: boolean;
  installing: boolean;
  onInstall: (item: PluginItem) => void;
}

function AvailablePluginRow({
  item,
  repoUrl,
  isInstalled,
  installing,
  onInstall,
}: AvailablePluginRowProps) {
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
              {formatPluginLanguage(item.lang)}
            </ConsoleChip>
            <ConsoleChip>
              v{item.version}
            </ConsoleChip>
            {isInstalled ? (
              <ConsoleChip tone="success">Installed</ConsoleChip>
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
            title="Open site in app"
          >
            {item.site}
          </Anchor>
          <Text size="xs" c="dimmed" truncate>
            Repository: {repoUrl}
          </Text>
        </Box>
        <Group gap="xs" wrap="wrap" justify="flex-end">
          <Button
            size="xs"
            variant="default"
            disabled={installing}
            onClick={() => openSite(item.site)}
          >
            Open site
          </Button>
          <Button
            size="xs"
            variant="light"
            disabled={isInstalled}
            loading={installing && !isInstalled}
            onClick={() => onInstall(item)}
          >
            {isInstalled ? "Installed" : "Install"}
          </Button>
        </Group>
      </Group>
    </div>
  );
}
