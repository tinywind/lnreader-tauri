import { Button, Group, Paper, Text } from "@mantine/core";

interface LibrarySelectionToolbarProps {
  count: number;
  onClear: () => void;
}

/**
 * Top bar that appears when one or more novels are selected.
 *
 * Action buttons (Mark read, Remove from library) are deliberately
 * disabled in v0.1 — Sprint 1 only ships the *UI shell* per
 * `prd.md §8`. Real wiring lands in Sprint 6 alongside the
 * Settings/More surface.
 */
export function LibrarySelectionToolbar({
  count,
  onClear,
}: LibrarySelectionToolbarProps) {
  return (
    <Paper withBorder p="xs" radius="md" shadow="sm">
      <Group justify="space-between" wrap="nowrap">
        <Text fw={600}>{count} selected</Text>
        <Group gap="xs" wrap="nowrap">
          <Button size="xs" variant="subtle" disabled title="Sprint 6">
            Mark read
          </Button>
          <Button size="xs" variant="subtle" disabled title="Sprint 6">
            Remove
          </Button>
          <Button size="xs" variant="light" onClick={onClear}>
            Done
          </Button>
        </Group>
      </Group>
    </Paper>
  );
}
