import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Button,
  Container,
  Divider,
  Group,
  Loader,
  Modal,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import {
  addRepository,
  listRepositories,
  removeRepository,
  type PluginRepository,
} from "../db/queries/repository";
import { pluginManager } from "../lib/plugins/manager";
import type { Plugin, PluginItem } from "../lib/plugins/types";
import { useBrowseStore } from "../store/browse";

const REPO_QUERY_KEY = ["repository", "list"] as const;
const AVAILABLE_QUERY_KEY = ["plugin", "available"] as const;
const INSTALLED_QUERY_KEY = ["plugin", "installed"] as const;

interface AvailableEntry {
  item: PluginItem;
  repoUrl: string;
}

async function fetchAllAvailable(
  repos: readonly PluginRepository[],
): Promise<AvailableEntry[]> {
  const all: AvailableEntry[] = [];
  for (const repo of repos) {
    try {
      const items = await pluginManager.fetchRepository(repo.url);
      for (const item of items) {
        all.push({ item, repoUrl: repo.url });
      }
    } catch {
      // Skip repos that can't be fetched/parsed; surfacing is per-repo
      // UX (a future iteration) not page-level.
    }
  }
  return all;
}

export function BrowsePage() {
  const queryClient = useQueryClient();
  const repos = useQuery({
    queryKey: REPO_QUERY_KEY,
    queryFn: listRepositories,
  });

  const installed = useQuery({
    queryKey: INSTALLED_QUERY_KEY,
    queryFn: () => Promise.resolve(pluginManager.list()),
    staleTime: 0,
  });

  const available = useQuery({
    queryKey: AVAILABLE_QUERY_KEY,
    queryFn: () => fetchAllAvailable(repos.data ?? []),
    enabled: !!repos.data && repos.data.length > 0,
  });

  const pendingRepoUrl = useBrowseStore((s) => s.pendingRepoUrl);
  const clearPendingRepoUrl = useBrowseStore(
    (s) => s.clearPendingRepoUrl,
  );

  const [addOpen, setAddOpen] = useState(false);
  const [url, setUrl] = useState("");

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
              onClick={() =>
                queryClient.invalidateQueries({
                  queryKey: AVAILABLE_QUERY_KEY,
                })
              }
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

        <InstalledSection
          query={installed}
          onUninstall={(id) => uninstallMutation.mutate(id)}
          uninstalling={uninstallMutation.isPending}
        />

        <Divider />

        <AvailableSection
          query={available}
          installedIds={
            new Set(installed.data?.map((p) => p.id) ?? [])
          }
          onInstall={(item) => installMutation.mutate(item)}
          installing={installMutation.isPending}
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
          <Text c="dimmed">Loading…</Text>
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
          Add a plugin repository URL — typically the lnreader-plugins
          index JSON. Deep-link <code>lnreader://repo/add?url=…</code>{" "}
          opens the Add dialog pre-filled.
        </Alert>
      )}
    </Stack>
  );
}

interface InstalledSectionProps {
  query: ReturnType<typeof useQuery<Plugin[]>>;
  onUninstall: (id: string) => void;
  uninstalling: boolean;
}

function InstalledSection({
  query,
  onUninstall,
  uninstalling,
}: InstalledSectionProps) {
  return (
    <Stack gap="xs">
      <Title order={3}>Installed plugins</Title>
      {query.data && query.data.length > 0 ? (
        <Stack gap={6}>
          {query.data.map((plugin) => (
            <Paper key={plugin.id} withBorder p="xs" radius="md">
              <Group justify="space-between" wrap="nowrap">
                <Stack gap={0} style={{ minWidth: 0 }}>
                  <Text size="sm" fw={500} truncate>
                    {plugin.name}{" "}
                    <Text span size="xs" c="dimmed">
                      ({plugin.lang} · v{plugin.version})
                    </Text>
                  </Text>
                  <Text size="xs" c="dimmed" truncate>
                    {plugin.site}
                  </Text>
                </Stack>
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
            </Paper>
          ))}
        </Stack>
      ) : (
        <Text c="dimmed" size="sm">
          No plugins installed yet. Install one from the list below.
        </Text>
      )}
    </Stack>
  );
}

interface AvailableSectionProps {
  query: ReturnType<typeof useQuery<AvailableEntry[]>>;
  installedIds: ReadonlySet<string>;
  onInstall: (item: PluginItem) => void;
  installing: boolean;
}

function AvailableSection({
  query,
  installedIds,
  onInstall,
  installing,
}: AvailableSectionProps) {
  return (
    <Stack gap="xs">
      <Title order={3}>Available plugins</Title>
      {query.isLoading || query.isFetching ? (
        <Group gap="sm">
          <Loader size="sm" />
          <Text c="dimmed">Fetching repository indexes…</Text>
        </Group>
      ) : query.error ? (
        <Alert color="red" title="Repository fetch error">
          {query.error instanceof Error
            ? query.error.message
            : String(query.error)}
        </Alert>
      ) : query.data && query.data.length > 0 ? (
        <Stack gap={6}>
          {query.data.map(({ item, repoUrl }) => {
            const isInstalled = installedIds.has(item.id);
            return (
              <Paper key={`${repoUrl}::${item.id}`} withBorder p="xs" radius="md">
                <Group justify="space-between" wrap="nowrap">
                  <Stack gap={0} style={{ minWidth: 0 }}>
                    <Text size="sm" fw={500} truncate>
                      {item.name}{" "}
                      <Text span size="xs" c="dimmed">
                        ({item.lang} · v{item.version})
                      </Text>
                    </Text>
                    <Text size="xs" c="dimmed" truncate>
                      {item.site}
                    </Text>
                  </Stack>
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
              </Paper>
            );
          })}
        </Stack>
      ) : (
        <Text c="dimmed" size="sm">
          {!query.data
            ? "Add a repository to populate this list."
            : "No plugins exposed by the configured repositories."}
        </Text>
      )}
    </Stack>
  );
}
