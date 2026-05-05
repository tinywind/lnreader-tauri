import { Button, Group, Paper, Text } from "@mantine/core";
import { useTranslation } from "../i18n";

interface LibrarySelectionToolbarProps {
  count: number;
  onClear: () => void;
}

/**
 * Top bar that appears when one or more novels are selected.
 *
 * Action buttons are deliberately disabled in v0.1. Sprint 1 only
 * ships the UI shell; real bulk actions land with the remaining
 * Settings surface.
 */
export function LibrarySelectionToolbar({
  count,
  onClear,
}: LibrarySelectionToolbarProps) {
  const { t } = useTranslation();

  return (
    <Paper withBorder p="xs" radius="md" shadow="sm">
      <Group justify="space-between" wrap="nowrap">
        <Text fw={600}>{t("library.selectedCount", { count })}</Text>
        <Group gap="xs" wrap="nowrap">
          <Button
            size="xs"
            variant="subtle"
            disabled
            title={t("library.selection.sprint6")}
          >
            {t("library.selection.markRead")}
          </Button>
          <Button
            size="xs"
            variant="subtle"
            disabled
            title={t("library.selection.sprint6")}
          >
            {t("common.remove")}
          </Button>
          <Button size="xs" variant="light" onClick={onClear}>
            {t("common.done")}
          </Button>
        </Group>
      </Group>
    </Paper>
  );
}
