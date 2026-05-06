import { Group, Paper, Text } from "@mantine/core";
import { useTranslation } from "../i18n";
import { TextButton } from "./TextButton";

interface LibrarySelectionToolbarProps {
  count: number;
  onClear: () => void;
}

/**
 * Top bar that appears when one or more novels are selected.
 *
 * Bulk action buttons stay disabled until the destructive paths are
 * implemented end-to-end.
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
          <TextButton
            size="sm"
            variant="subtle"
            disabled
            title={t("library.selection.unavailable")}
          >
            {t("library.selection.markRead")}
          </TextButton>
          <TextButton
            size="sm"
            variant="subtle"
            disabled
            title={t("library.selection.unavailable")}
          >
            {t("common.remove")}
          </TextButton>
          <TextButton size="sm" variant="light" onClick={onClear}>
            {t("common.done")}
          </TextButton>
        </Group>
      </Group>
    </Paper>
  );
}
