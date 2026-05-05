import { useState } from "react";
import {
  Alert,
  Button,
  Container,
  Group,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import {
  exportBackupToFile,
  importBackupFromFile,
} from "../lib/backup/io";

type Status =
  | { kind: "idle" }
  | { kind: "busy"; message: string }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };

const RESTORE_WARNING =
  "Restoring will replace your current library, chapters, categories, and " +
  "repositories with the contents of the backup file. Continue?";

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function MorePage() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const isBusy = status.kind === "busy";

  async function handleExport(): Promise<void> {
    setStatus({ kind: "busy", message: "Saving backup…" });
    try {
      const path = await exportBackupToFile();
      setStatus(
        path
          ? { kind: "ok", message: `Backup saved to ${path}` }
          : { kind: "idle" },
      );
    } catch (error) {
      setStatus({
        kind: "error",
        message: `Export failed: ${describeError(error)}`,
      });
    }
  }

  async function handleImport(): Promise<void> {
    if (!window.confirm(RESTORE_WARNING)) {
      return;
    }
    setStatus({ kind: "busy", message: "Restoring backup…" });
    try {
      const path = await importBackupFromFile();
      setStatus(
        path
          ? { kind: "ok", message: `Restored from ${path}` }
          : { kind: "idle" },
      );
    } catch (error) {
      setStatus({
        kind: "error",
        message: `Restore failed: ${describeError(error)}`,
      });
    }
  }

  return (
    <Container py="lg" size="md">
      <Stack gap="lg">
        <Title order={2}>More</Title>

        <Stack gap="sm">
          <Title order={4}>Backup</Title>
          <Text c="dimmed" size="sm">
            Save your library, chapters, categories, and repositories
            into a single .zip file you can restore later.
          </Text>
          <Group>
            <Button onClick={handleExport} loading={isBusy} disabled={isBusy}>
              Export backup
            </Button>
            <Button
              onClick={handleImport}
              loading={isBusy}
              disabled={isBusy}
              variant="default"
            >
              Import backup
            </Button>
          </Group>
          {status.kind === "ok" && (
            <Alert color="green" variant="light">
              {status.message}
            </Alert>
          )}
          {status.kind === "error" && (
            <Alert color="red" variant="light" title="Backup error">
              {status.message}
            </Alert>
          )}
          {status.kind === "busy" && (
            <Text size="sm" c="dimmed">
              {status.message}
            </Text>
          )}
        </Stack>
      </Stack>
    </Container>
  );
}
