import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Button,
  Container,
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
} from "../db/queries/repository";
import { useBrowseStore } from "../store/browse";

export function BrowsePage() {
  const queryClient = useQueryClient();
  const repos = useQuery({
    queryKey: ["repository", "list"],
    queryFn: listRepositories,
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

  const addMutation = useMutation({
    mutationFn: async () => {
      const trimmed = url.trim();
      if (trimmed === "") return;
      await addRepository({ url: trimmed });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repository"] });
      setUrl("");
      setAddOpen(false);
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (id: number) => removeRepository(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["repository"] }),
  });

  return (
    <Container size="lg" py="xl">
      <Stack gap="md">
        <Group justify="space-between" align="baseline">
          <Title order={1}>Browse</Title>
          <Group gap="xs">
            <Badge variant="light" color="grape">
              Sprint 2 (in progress)
            </Badge>
            <Button
              size="xs"
              variant="light"
              onClick={() => setAddOpen(true)}
            >
              + Add repository
            </Button>
          </Group>
        </Group>

        <Text c="dimmed" size="sm">
          Plugin repositories. Deep-link <code>lnreader://repo/add?url=…</code>{" "}
          opens this Add Repository modal pre-filled. Source listings,
          search, and Cloudflare bypass land in later Sprint 2 iterations.
        </Text>

        {repos.isLoading ? (
          <Group gap="sm">
            <Loader size="sm" />
            <Text c="dimmed">Loading…</Text>
          </Group>
        ) : repos.error ? (
          <Alert color="red" title="Database error">
            {repos.error instanceof Error
              ? repos.error.message
              : String(repos.error)}
          </Alert>
        ) : repos.data && repos.data.length > 0 ? (
          <Stack gap={6}>
            {repos.data.map((repo) => (
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
                    loading={removeMutation.isPending}
                    onClick={() => removeMutation.mutate(repo.id)}
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
            index JSON. Repository scrape lands in a later Sprint 2
            iteration.
          </Alert>
        )}

        <Modal
          opened={addOpen}
          onClose={() => setAddOpen(false)}
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
            <Group justify="flex-end">
              <Button variant="subtle" onClick={() => setAddOpen(false)}>
                Cancel
              </Button>
              <Button
                loading={addMutation.isPending}
                disabled={url.trim() === ""}
                onClick={() => addMutation.mutate()}
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
