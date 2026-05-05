import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Container,
  Divider,
  Group,
  Loader,
  Modal,
  MultiSelect,
  NumberInput,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
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
 * `forceRefresh=false` (default — Browse mount, query refetch):
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

export function BrowsePage() {
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
    <Container size="lg" py="xl">
      <Stack gap="xl">
        <Group justify="space-between" align="baseline">
          <Title order={1}>Browse</Title>
          <Group gap="xs">
            <Badge variant="light" color="grape">
              Sprint 2
            </Badge>
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
          </Group>
        </Group>

        <RepositoriesSection
          query={repos}
          onRemove={(id) => removeRepoMutation.mutate(id)}
          removing={removeRepoMutation.isPending}
        />

        <Divider />

        <PluginSettingsSection
          languageOptions={languageOptions}
          selectedLanguages={pluginLanguageFilter}
          onLanguageChange={setPluginLanguageFilter}
          globalSearchConcurrency={globalSearchConcurrency}
          onGlobalSearchConcurrencyChange={setGlobalSearchConcurrency}
        />

        <Divider />

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

        <Divider />

        <AvailableSection
          query={available}
          entries={filteredAvailableEntries}
          installedIds={
            new Set(installed.data?.map((p) => p.id) ?? [])
          }
          onInstall={(item) => installMutation.mutate(item)}
          installing={installMutation.isPending}
          failures={available.data?.failures ?? []}
        />

        <Modal
          opened={addOpen}
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
              <Alert color="red" variant="light" title="Add failed">
                {addRepoMutation.error instanceof Error
                  ? addRepoMutation.error.message
                  : String(addRepoMutation.error)}
              </Alert>
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
      </Stack>
    </Container>
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
    <Stack gap="xs">
      <Title order={3}>Plugin settings</Title>
      <Paper withBorder p="sm" radius="md">
        <Stack gap="sm">
          <MultiSelect
            label="Plugin languages"
            description="Only plugins matching these languages appear in installed, available, and global search lists."
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
        </Stack>
      </Paper>
      {selectedLanguages.length === 0 ? (
        <Alert color="blue" variant="light">
          No plugin languages are selected, so Browse shows every
          plugin language.
        </Alert>
      ) : null}
    </Stack>
  );
}

function RepositoriesSection({
  query,
  onRemove,
  removing,
}: RepositoriesSectionProps) {
  return (
    <Stack gap="xs">
      <Title order={3}>Repositories</Title>
      {query.isLoading ? (
        <Group gap="sm">
          <Loader size="sm" />
          <Text c="dimmed">Loading...</Text>
        </Group>
      ) : query.error ? (
        <Alert color="red" title="Database error">
          {query.error instanceof Error
            ? query.error.message
            : String(query.error)}
        </Alert>
      ) : query.data && query.data.length > 0 ? (
        <Stack gap={6}>
          {query.data.map((repo) => (
            <Paper key={repo.id} withBorder p="xs" radius="md">
              <Group justify="space-between" wrap="nowrap">
                <Stack gap={0} style={{ minWidth: 0 }}>
                  <Text size="sm" fw={500} truncate>
                    {repo.name ?? repo.url}
                  </Text>
                  {repo.name ? (
                    <Text size="xs" c="dimmed" truncate>
                      {repo.url}
                    </Text>
                  ) : null}
                </Stack>
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
            </Paper>
          ))}
        </Stack>
      ) : (
        <Alert color="blue" title="No repositories yet">
          Add a plugin repository URL, typically the lnreader-plugins
          index JSON. Deep-link <code>lnreader://repo/add?url=...</code>{" "}
          opens the Add dialog pre-filled.
        </Alert>
      )}
    </Stack>
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
 * Open the plugin's site in the in-app full-screen layered modal
 * over the main window. The scraper Webview is shared, so any
 * cookies (login, CF clearance) the user accumulates here are
 * automatically attached to the next pluginFetch; there is no
 * per-plugin cookie store on the host side.
 */
function openSite(url: string): void {
  useSiteBrowserStore.getState().openAt(url);
}

interface PluginRowProps {
  plugin: Plugin;
  pinned: boolean;
  onTogglePin: (id: string) => void;
  onOpenSource: (plugin: Plugin) => void;
  onUninstall: (id: string) => void;
  uninstalling: boolean;
}

function PluginRow({
  plugin,
  pinned,
  onTogglePin,
  onOpenSource,
  onUninstall,
  uninstalling,
}: PluginRowProps) {
  return (
    <Paper key={plugin.id} withBorder p="xs" radius="md">
      <Group justify="space-between" wrap="nowrap">
        <Stack gap={0} style={{ minWidth: 0 }}>
          <Text size="sm" fw={500} truncate>
            {plugin.name}{" "}
            <Text span size="xs" c="dimmed">
              ({plugin.lang} - v{plugin.version})
            </Text>
          </Text>
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
        </Stack>
        <Group gap="xs" wrap="nowrap">
          <Button size="xs" onClick={() => onOpenSource(plugin)}>
            Source
          </Button>
          <Button
            size="xs"
            variant={pinned ? "light" : "default"}
            onClick={() => onTogglePin(plugin.id)}
          >
            {pinned ? "Unpin" : "Pin"}
          </Button>
          <Button
            size="xs"
            variant="default"
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
    </Paper>
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
    <Stack gap="xs">
      <Title order={3}>Installed plugins</Title>
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
                onTogglePin={onTogglePin}
                onOpenSource={onOpenSource}
                onUninstall={onUninstall}
                uninstalling={uninstalling}
              />
            ))}
          </Stack>
        </Stack>
      ) : (
        <Text c="dimmed" size="sm">
          No installed plugins match the selected languages.
        </Text>
      )}
    </Stack>
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
    <Stack gap="xs">
      <Title order={3}>Available plugins</Title>
      {failures.length > 0 && (
        <Stack gap={4}>
          {failures.map((failure) => (
            <Alert
              key={failure.repoUrl}
              color="red"
              variant="light"
              title={`Couldn't fetch ${failure.repoUrl}`}
            >
              {failure.message}
            </Alert>
          ))}
        </Stack>
      )}
      {query.isLoading || query.isFetching ? (
        <Group gap="sm">
          <Loader size="sm" />
          <Text c="dimmed">Fetching repository indexes...</Text>
        </Group>
      ) : query.error ? (
        <Alert color="red" title="Repository fetch error">
          {query.error instanceof Error
            ? query.error.message
            : String(query.error)}
        </Alert>
      ) : entries.length > 0 ? (
        <Stack gap={6}>
          {entries.map(({ item, repoUrl }) => {
            const isInstalled = installedIds.has(item.id);
            return (
              <Paper key={`${repoUrl}::${item.id}`} withBorder p="xs" radius="md">
                <Group justify="space-between" wrap="nowrap">
                  <Stack gap={0} style={{ minWidth: 0 }}>
                    <Text size="sm" fw={500} truncate>
                      {item.name}{" "}
                      <Text span size="xs" c="dimmed">
                        ({item.lang} - v{item.version})
                      </Text>
                    </Text>
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
                  </Stack>
                  <Group gap="xs" wrap="nowrap">
                    <Button
                      size="xs"
                      variant="default"
                      onClick={() => openSite(item.site)}
                    >
                      Open site
                    </Button>
                    <Button
                      size="xs"
                      variant="light"
                      disabled={isInstalled}
                      loading={installing}
                      onClick={() => onInstall(item)}
                    >
                      {isInstalled ? "Installed" : "Install"}
                    </Button>
                  </Group>
                </Group>
              </Paper>
            );
          })}
        </Stack>
      ) : (
        <Text c="dimmed" size="sm">
          {!query.data
            ? "Add a repository to populate this list."
            : failures.length > 0
              ? "All configured repositories failed; see the errors above."
              : "No plugins exposed by the configured repositories."}
        </Text>
      )}
    </Stack>
  );
}
