import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Button,
  Container,
  Group,
  Loader,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { LibraryGrid } from "../components/LibraryGrid";
import { insertNovel, listLibraryNovels } from "../db/queries/novel";

const LIBRARY_QUERY_KEY = ["novel", "library"] as const;

export function LibraryPage() {
  const queryClient = useQueryClient();

  const novels = useQuery({
    queryKey: LIBRARY_QUERY_KEY,
    queryFn: listLibraryNovels,
  });

  const seed = useMutation({
    mutationFn: async () => {
      const stamp = Date.now();
      await insertNovel({
        pluginId: "local",
        path: `local-${stamp}`,
        name: `Sample novel #${stamp}`,
        cover: null,
      });
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["novel"] }),
  });

  return (
    <Container size="lg" py="xl">
      <Stack gap="md">
        <Group justify="space-between" align="baseline">
          <Title order={1}>Library</Title>
          <Group gap="xs">
            <Badge variant="light" color="gray">
              Sprint 1
            </Badge>
            <Button
              size="xs"
              variant="light"
              loading={seed.isPending}
              onClick={() => seed.mutate()}
            >
              + Seed novel
            </Button>
          </Group>
        </Group>

        {novels.isLoading ? (
          <Group gap="sm">
            <Loader size="sm" />
            <Text c="dimmed">Loading library…</Text>
          </Group>
        ) : novels.error ? (
          <Alert color="red" title="Database error">
            {novels.error instanceof Error
              ? novels.error.message
              : String(novels.error)}
          </Alert>
        ) : novels.data && novels.data.length > 0 ? (
          <LibraryGrid novels={novels.data} />
        ) : (
          <Alert color="blue" title="Empty library">
            No novels yet. Click "+ Seed novel" to insert a sample row.
          </Alert>
        )}
      </Stack>
    </Container>
  );
}
