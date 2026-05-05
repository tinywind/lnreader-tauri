import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Container,
  Group,
  Loader,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { getDb } from "../db";

interface CountRow {
  count: number;
}

async function fetchNovelCount(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<CountRow[]>(
    "SELECT COUNT(*) AS count FROM novel",
  );
  return rows[0]?.count ?? 0;
}

export function LibraryPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["novel", "count"],
    queryFn: fetchNovelCount,
  });

  return (
    <Container size="sm" py="xl">
      <Stack gap="md">
        <Group justify="space-between" align="baseline">
          <Title order={1}>LNReaderTauri</Title>
          <Badge variant="light" color="gray">
            Sprint 1
          </Badge>
        </Group>
        <Text c="dimmed">
          Library — bound to local SQLite via{" "}
          <Text span fw={600}>
            tauri-plugin-sql
          </Text>{" "}
          and queried with TanStack Query.
        </Text>
        {isLoading ? (
          <Group gap="sm">
            <Loader size="sm" />
            <Text c="dimmed">Opening database…</Text>
          </Group>
        ) : error ? (
          <Alert color="red" title="Database error">
            {error instanceof Error ? error.message : String(error)}
          </Alert>
        ) : (
          <Alert color="green" title="Library">
            Novels:{" "}
            <Text span fw={700}>
              {data}
            </Text>
          </Alert>
        )}
      </Stack>
    </Container>
  );
}
