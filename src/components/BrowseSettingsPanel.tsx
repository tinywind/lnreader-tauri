import {
  Badge,
  Button,
  Group,
  NumberInput,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import { formatPluginLanguageForLocale, useTranslation } from "../i18n";
import { pluginManager } from "../lib/plugins/manager";
import { useBrowseStore } from "../store/browse";

export function BrowseSettingsPanel() {
  const { locale, t } = useTranslation();
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

  const installedPlugins = pluginManager.list();
  const lastUsedPlugin = installedPlugins.find(
    (plugin) => plugin.id === lastUsedPluginId,
  );

  return (
    <Stack gap="md">
      <NumberInput
        label={t("browseSettings.globalSearchConcurrency")}
        value={globalSearchConcurrency}
        min={1}
        max={10}
        step={1}
        clampBehavior="strict"
        onChange={(value) => {
          if (typeof value === "number") {
            setGlobalSearchConcurrency(value);
          }
        }}
      />
      <Stack gap="xs">
        <Group justify="space-between" align="center">
          <Text fw={600} size="sm">
            {t("browseSettings.pinnedPlugins")}
          </Text>
          <Badge variant="light">
            {t("browseSettings.pinnedCount", {
              count: pinnedPluginIds.length,
            })}
          </Badge>
        </Group>
        {installedPlugins.length > 0 ? (
          <Stack gap={6}>
            {installedPlugins.map((plugin) => (
              <Switch
                key={plugin.id}
                label={`${plugin.name} (${formatPluginLanguageForLocale(
                  locale,
                  plugin.lang,
                )})`}
                checked={pinnedPluginIds.includes(plugin.id)}
                onChange={() => togglePinnedPlugin(plugin.id)}
              />
            ))}
          </Stack>
        ) : (
          <Text size="sm" c="dimmed">
            {t("browseSettings.noPluginsInstalled")}
          </Text>
        )}
      </Stack>
      <Group justify="space-between" align="center">
        <Text size="sm">
          {t("browseSettings.lastUsedPlugin", {
            name: lastUsedPlugin?.name ?? lastUsedPluginId ?? t("browseSettings.none"),
          })}
        </Text>
        <Button
          size="xs"
          variant="default"
          disabled={lastUsedPluginId === null}
          onClick={() => setLastUsedPluginId(null)}
        >
          {t("common.clear")}
        </Button>
      </Group>
    </Stack>
  );
}
