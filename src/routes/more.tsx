import { useState } from "react";
import {
  Alert,
  Anchor,
  Button,
  ColorInput,
  Container,
  Divider,
  Group,
  Select,
  Stack,
  Switch,
  Text,
  Textarea,
  Title,
} from "@mantine/core";
import { invoke } from "@tauri-apps/api/core";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import {
  clearCachedNovels,
  clearUpdatesTab,
  deleteReadDownloadedChapters,
} from "../db/queries/maintenance";
import {
  exportBackupToFile,
  importBackupFromFile,
} from "../lib/backup/io";
import {
  DEFAULT_USER_AGENT,
  useUserAgentStore,
} from "../store/user-agent";
import {
  DEFAULT_APPEARANCE,
  type AppThemeMode,
  useAppearanceStore,
} from "../store/appearance";
import { APP_THEME_OPTIONS, type AppThemeId } from "../theme/md3";

type Status =
  | { kind: "idle" }
  | { kind: "busy"; message: string }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };

const RESTORE_WARNING =
  "Restoring will replace your current library, chapters, categories, and " +
  "repositories with the contents of the backup file. Continue?";

const LATEST_RELEASE_URL =
  "https://github.com/tinywind/lnreader-tauri/releases/latest";
const PLUGIN_STORAGE_PREFIX = "plugin:";

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clearStorageByPrefix(storage: Storage, prefix: string): number {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key?.startsWith(prefix)) {
      keys.push(key);
    }
  }
  for (const key of keys) {
    storage.removeItem(key);
  }
  return keys.length;
}

function clearAccessibleCookies(): number {
  if (document.cookie.trim() === "") {
    return 0;
  }
  const cookies = document.cookie.split(";");
  for (const cookie of cookies) {
    const name = cookie.split("=")[0]?.trim();
    if (name) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    }
  }
  return cookies.length;
}

export function MorePage() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const userAgent = useUserAgentStore((state) => state.userAgent);
  const setUserAgent = useUserAgentStore((state) => state.setUserAgent);
  const resetUserAgent = useUserAgentStore((state) => state.resetUserAgent);
  const appearance = useAppearanceStore();
  const [userAgentInput, setUserAgentInput] = useState(userAgent);

  const isBusy = status.kind === "busy";

  async function handleExport(): Promise<void> {
    setStatus({ kind: "busy", message: "Saving backup..." });
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
    setStatus({ kind: "busy", message: "Restoring backup..." });
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

  async function runMaintenance(
    message: string,
    warning: string,
    action: () => Promise<{ rowsAffected: number }>,
  ): Promise<void> {
    if (!window.confirm(warning)) {
      return;
    }
    setStatus({ kind: "busy", message });
    try {
      const result = await action();
      setStatus({
        kind: "ok",
        message: `${message} Done. ${result.rowsAffected} rows changed.`,
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message: `${message} Failed: ${describeError(error)}`,
      });
    }
  }

  async function handleClearStorage(): Promise<void> {
    const localCount = clearStorageByPrefix(
      window.localStorage,
      PLUGIN_STORAGE_PREFIX,
    );
    const sessionCount = clearStorageByPrefix(
      window.sessionStorage,
      PLUGIN_STORAGE_PREFIX,
    );
    const cookieCount = clearAccessibleCookies();
    setStatus({ kind: "busy", message: "Clearing plugin storage..." });
    try {
      const webviewCookieCount = await invoke<number>("scraper_clear_cookies");
      setStatus({
        kind: "ok",
        message:
          `Cleared ${localCount + sessionCount} plugin storage keys, ` +
          `${cookieCount} app-origin cookies, and ` +
          `${webviewCookieCount} site WebView cookies.`,
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          `Cleared ${localCount + sessionCount} plugin storage keys and ` +
          `${cookieCount} app-origin cookies, but site WebView cookie clear ` +
          `failed: ${describeError(error)}`,
      });
    }
  }

  function handleSaveUserAgent(): void {
    setUserAgent(userAgentInput);
    setStatus({ kind: "ok", message: "User-Agent saved." });
  }

  function handleResetUserAgent(): void {
    resetUserAgent();
    setUserAgentInput(DEFAULT_USER_AGENT);
    setStatus({ kind: "ok", message: "User-Agent reset to default." });
  }

  return (
    <Container py="lg" size="md">
      <Stack gap="lg">
        <Title order={2}>More</Title>

        {status.kind === "ok" && (
          <Alert color="green" variant="light">
            {status.message}
          </Alert>
        )}
        {status.kind === "error" && (
          <Alert color="red" variant="light" title="More error">
            {status.message}
          </Alert>
        )}
        {status.kind === "busy" && (
          <Text size="sm" c="dimmed">
            {status.message}
          </Text>
        )}

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
        </Stack>

        <Divider />

        <Stack gap="sm">
          <Title order={4}>Appearance</Title>
          <Group grow>
            <Select
              label="Theme mode"
              data={[
                { value: "system", label: "System" },
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
              ]}
              value={appearance.themeMode}
              onChange={(themeMode) =>
                appearance.setThemeMode((themeMode ?? "system") as AppThemeMode)
              }
            />
            <Select
              label="App theme"
              data={APP_THEME_OPTIONS}
              value={appearance.appThemeId}
              onChange={(appThemeId) =>
                appearance.setAppThemeId((appThemeId ?? "default") as AppThemeId)
              }
            />
          </Group>
          <Group grow>
            <ColorInput
              label="Custom accent color"
              value={appearance.customAccentColor}
              placeholder="Use theme accent"
              onChange={appearance.setCustomAccentColor}
            />
            <Select
              label="Locale"
              data={[
                { value: "en", label: "English" },
                { value: "ko", label: "Korean" },
                { value: "ja", label: "Japanese" },
                { value: "zh", label: "Chinese" },
              ]}
              value={appearance.appLocale}
              onChange={(appLocale) =>
                appearance.setAppLocale(appLocale ?? DEFAULT_APPEARANCE.appLocale)
              }
            />
          </Group>
          <Group>
            <Switch
              label="AMOLED black"
              checked={appearance.amoledBlack}
              onChange={(event) =>
                appearance.setAmoledBlack(event.currentTarget.checked)
              }
            />
            <Switch
              label="History tab"
              checked={appearance.showHistoryTab}
              onChange={(event) =>
                appearance.setShowHistoryTab(event.currentTarget.checked)
              }
            />
            <Switch
              label="Updates tab"
              checked={appearance.showUpdatesTab}
              onChange={(event) =>
                appearance.setShowUpdatesTab(event.currentTarget.checked)
              }
            />
            <Switch
              label="Navigation labels"
              checked={appearance.showLabelsInNav}
              onChange={(event) =>
                appearance.setShowLabelsInNav(event.currentTarget.checked)
              }
            />
          </Group>
          <Group>
            <Button variant="default" onClick={appearance.resetAppearance}>
              Reset appearance
            </Button>
          </Group>
        </Stack>

        <Divider />

        <Stack gap="sm">
          <Title order={4}>Advanced</Title>
          <Text fw={600} size="sm">
            Data management
          </Text>
          <Text c="dimmed" size="sm">
            These actions remove local cache and reading data. They do not
            touch trackers, Google Drive, or self-hosted backup settings.
          </Text>
          <Group>
            <Button
              disabled={isBusy}
              loading={isBusy}
              variant="default"
              onClick={() => {
                void runMaintenance(
                  "Clearing cached novels...",
                  "Delete all non-library novels and their chapters?",
                  clearCachedNovels,
                );
              }}
            >
              Clear cached novels
            </Button>
            <Button
              disabled={isBusy}
              loading={isBusy}
              variant="default"
              onClick={() => {
                void runMaintenance(
                  "Clearing updates...",
                  "Mark all current library updates as read?",
                  clearUpdatesTab,
                );
              }}
            >
              Clear updates tab
            </Button>
            <Button
              disabled={isBusy}
              loading={isBusy}
              variant="default"
              onClick={() => {
                void runMaintenance(
                  "Deleting read downloaded chapters...",
                  "Delete downloaded content for chapters already marked read?",
                  deleteReadDownloadedChapters,
                );
              }}
            >
              Delete read downloads
            </Button>
            <Button
              variant="default"
              onClick={() => {
                void handleClearStorage();
              }}
            >
              Clear cookies and plugin storage
            </Button>
          </Group>

          <Textarea
            label="Custom User-Agent"
            value={userAgentInput}
            autosize
            minRows={3}
            onChange={(event) => setUserAgentInput(event.currentTarget.value)}
          />
          <Group>
            <Button onClick={handleSaveUserAgent}>Save User-Agent</Button>
            <Button variant="default" onClick={handleResetUserAgent}>
              Reset
            </Button>
          </Group>
          <Text c="dimmed" size="xs">
            Current plugin requests use this value when a plugin does not set
            its own User-Agent header.
          </Text>
        </Stack>

        <Divider />

        <Stack gap="sm">
          <Title order={4}>About</Title>
          <Text size="sm" c="dimmed">
            v0.1 ships unsigned debug builds. In-app auto-update lands
            in v0.2. Until then, check the latest GitHub release for
            updates.
          </Text>
          <Group>
            <Button
              variant="default"
              onClick={() => {
                void openExternal(LATEST_RELEASE_URL).catch((error: unknown) => {
                  setStatus({
                    kind: "error",
                    message: `Failed to open release page: ${describeError(error)}`,
                  });
                });
              }}
            >
              Open latest release
            </Button>
            <Anchor
              href={LATEST_RELEASE_URL}
              target="_blank"
              rel="noreferrer"
              size="sm"
            >
              {LATEST_RELEASE_URL}
            </Anchor>
          </Group>
        </Stack>
      </Stack>
    </Container>
  );
}
