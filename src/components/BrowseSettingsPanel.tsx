import { useMemo } from "react";
import {
  Alert,
  Badge,
  Button,
  Group,
  MultiSelect,
  NumberInput,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import { pluginManager } from "../lib/plugins/manager";
import type { Plugin } from "../lib/plugins/types";
import { useBrowseStore } from "../store/browse";

interface LanguageOption {
  value: string;
  label: string;
}

function formatPluginLanguage(lang: string): string {
  if (lang === "multi") return "Multi";
  try {
    const displayNames = new Intl.DisplayNames(["en"], {
      type: "language",
    });
    return displayNames.of(lang) ?? lang;
  } catch {
    return lang;
  }
}

function makeLanguageOptions(
  plugins: readonly Plugin[],
  selectedLanguages: readonly string[],
): LanguageOption[] {
  const languages = [
    ...selectedLanguages,
    ...plugins.map((plugin) => plugin.lang),
  ].filter((value): value is string => value.length > 0);
  return [...new Set(languages)]
    .sort((a, b) =>
      formatPluginLanguage(a).localeCompare(formatPluginLanguage(b)),
    )
    .map((lang) => ({
      value: lang,
      label: `${formatPluginLanguage(lang)} (${lang})`,
    }));
}

export function BrowseSettingsPanel() {
  const pluginLanguageFilter = useBrowseStore(
    (s) => s.pluginLanguageFilter,
  );
  const setPluginLanguageFilter = useBrowseStore(
    (s) => s.setPluginLanguageFilter,
  );
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
  const languageOptions = useMemo(
    () => makeLanguageOptions(installedPlugins, pluginLanguageFilter),
    [installedPlugins, pluginLanguageFilter],
  );
  const lastUsedPlugin = installedPlugins.find(
    (plugin) => plugin.id === lastUsedPluginId,
  );

  return (
    <Stack gap="md">
      <MultiSelect
        label="Plugin languages"
        data={languageOptions}
        value={pluginLanguageFilter}
        onChange={setPluginLanguageFilter}
        placeholder="Select languages"
        searchable
        clearable
      />
      {pluginLanguageFilter.length === 0 ? (
        <Alert color="blue" variant="light">
          No plugin languages are selected, so Browse shows every
          plugin language.
        </Alert>
      ) : null}
      <NumberInput
        label="Global search concurrency"
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
            Pinned plugins
          </Text>
          <Badge variant="light">{pinnedPluginIds.length} pinned</Badge>
        </Group>
        {installedPlugins.length > 0 ? (
          <Stack gap={6}>
            {installedPlugins.map((plugin) => (
              <Switch
                key={plugin.id}
                label={`${plugin.name} (${formatPluginLanguage(plugin.lang)})`}
                checked={pinnedPluginIds.includes(plugin.id)}
                onChange={() => togglePinnedPlugin(plugin.id)}
              />
            ))}
          </Stack>
        ) : (
          <Text size="sm" c="dimmed">
            No plugins are installed.
          </Text>
        )}
      </Stack>
      <Group justify="space-between" align="center">
        <Text size="sm">
          Last used plugin: {lastUsedPlugin?.name ?? lastUsedPluginId ?? "None"}
        </Text>
        <Button
          size="xs"
          variant="default"
          disabled={lastUsedPluginId === null}
          onClick={() => setLastUsedPluginId(null)}
        >
          Clear
        </Button>
      </Group>
    </Stack>
  );
}
