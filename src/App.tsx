import { useEffect, useState } from "react";
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
import { getDb } from "./db";

interface CountRow {
  count: number;
}

type DbState =
  | { status: "loading" }
  | { status: "ready"; novelCount: number }
  | { status: "error"; message: string };

export function App() {
  const [state, setState] = useState<DbState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const db = await getDb();
        const rows = await db.select<CountRow[]>(
          "SELECT COUNT(*) AS count FROM novel",
        );
        if (cancelled) return;
        setState({ status: "ready", novelCount: rows[0]?.count ?? 0 });
      } catch (error: unknown) {
        if (cancelled) return;
        const message =
          error instanceof Error ? error.message : String(error);
        setState({ status: "error", message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Container size="sm" py="xl">
      <Stack gap="md">
        <Group justify="space-between" align="baseline">
          <Title order={1}>LNReaderTauri</Title>
          <Badge variant="light" color="gray">
            Sprint 0
          </Badge>
        </Group>
        <Text c="dimmed">
          Tauri 2 + React 19 + Mantine, talking to SQLite via{" "}
          <Text span fw={600}>
            tauri-plugin-sql
          </Text>
          .
        </Text>
        {state.status === "loading" ? (
          <Group gap="sm">
            <Loader size="sm" />
            <Text c="dimmed">Opening database…</Text>
          </Group>
        ) : state.status === "error" ? (
          <Alert color="red" title="Database error">
            {state.message}
          </Alert>
        ) : (
          <Alert color="green" title="Database ready">
            Novels in library:{" "}
            <Text span fw={700}>
              {state.novelCount}
            </Text>
          </Alert>
        )}
      </Stack>
    </Container>
  );
}
