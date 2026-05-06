import {
  NumberInput,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import {
  SettingsFieldRow,
  SettingsWideField,
} from "./SettingsPrimitives";
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

  const installedPlugins = pluginManager.list();

  return (
    <Stack gap="md">
      <SettingsFieldRow label={t("browseSettings.globalSearchConcurrency")}>
        <NumberInput
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
      </SettingsFieldRow>
      <SettingsFieldRow
        label={t("browseSettings.pinnedPlugins")}
        layout="stacked"
      >
        <SettingsWideField>
          {installedPlugins.length > 0 ? (
            <Stack className="lnr-settings-switch-list" gap={6}>
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
        </SettingsWideField>
      </SettingsFieldRow>
    </Stack>
  );
}
