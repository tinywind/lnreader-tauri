import { useEffect, useState, type ReactNode } from "react";
import {
  Anchor,
  Box,
  Button,
  ColorInput,
  Group,
  ScrollArea,
  Select,
  Stack,
  Switch,
  Text,
  Textarea,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { invoke } from "@tauri-apps/api/core";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import {
  PageFrame,
  StateView,
} from "../components/AppFrame";
import { BrowseSettingsPanel } from "../components/BrowseSettingsPanel";
import {
  ConsoleChip,
  ConsolePanel,
  ConsoleStatusStrip,
} from "../components/ConsolePrimitives";
import { LibrarySettingsPanel } from "../components/LibrarySettingsPanel";
import { ReaderSettingsPanel } from "../components/ReaderSettingsPanel";
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
  DEFAULT_APPEARANCE,
  type AppThemeMode,
  useAppearanceStore,
} from "../store/appearance";
import {
  DEFAULT_USER_AGENT,
  useUserAgentStore,
} from "../store/user-agent";
import { APP_THEME_OPTIONS, type AppThemeId } from "../theme/md3";
import "../styles/settings.css";

type Status =
  | { kind: "idle" }
  | { kind: "busy"; message: string }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };

type SettingsCategoryId =
  | "app"
  | "reader"
  | "library"
  | "browse"
  | "data"
  | "about";

interface SettingsCategory {
  content: ReactNode;
  groupCount: number;
  id: SettingsCategoryId;
  summary: string;
  title: string;
}

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

function normalizeSection(section: string | undefined): SettingsCategoryId {
  switch (section?.toLowerCase()) {
    case "reader":
      return "reader";
    case "library":
      return "library";
    case "browse":
      return "browse";
    case "data":
      return "data";
    case "about":
      return "about";
    case "app":
    default:
      return "app";
  }
}

function StatusBanner({ status }: { status: Status }) {
  if (status.kind === "ok") {
    return (
      <StateView
        color="green"
        title="Settings updated"
        message={status.message}
      />
    );
  }
  if (status.kind === "error") {
    return (
      <StateView
        color="red"
        title="Settings error"
        message={status.message}
      />
    );
  }
  if (status.kind === "busy") {
    return (
      <StateView
        color="blue"
        title="Working"
        message={status.message}
      />
    );
  }
  return null;
}

function SettingsSection({
  title,
  summary,
  children,
}: {
  title: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <ConsolePanel
      className="lnr-settings-group"
      title={
        <Stack gap={2}>
          <Text className="lnr-settings-group-title">{title}</Text>
          <Text className="lnr-settings-group-summary">{summary}</Text>
        </Stack>
      }
    >
      <div className="lnr-settings-group-body">{children}</div>
    </ConsolePanel>
  );
}

function SettingsFormRow({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="lnr-settings-form-row">
      <div className="lnr-settings-form-copy">
        <Text className="lnr-settings-form-label">{label}</Text>
        <Text className="lnr-settings-form-description">{description}</Text>
      </div>
      <div className="lnr-settings-form-control">{children}</div>
    </div>
  );
}

function AppSettingsSection() {
  const appearance = useAppearanceStore();

  return (
    <Stack gap="md">
      <SettingsSection
        title="Appearance"
        summary="Theme mode, accent color, and display surface."
      >
        <SettingsFormRow
          label="Theme mode"
          description="Follow the system theme or force a specific mode."
        >
          <Select
            data={[
              { value: "system", label: "System" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
            value={appearance.themeMode}
            onChange={(themeMode) =>
              appearance.setThemeMode((themeMode ?? "system") as AppThemeMode)
            }
            w={{ base: "100%", sm: 220 }}
          />
        </SettingsFormRow>
        <SettingsFormRow
          label="App theme"
          description="Choose the app color set used by the shell."
        >
          <Select
            data={APP_THEME_OPTIONS}
            value={appearance.appThemeId}
            onChange={(appThemeId) =>
              appearance.setAppThemeId((appThemeId ?? "default") as AppThemeId)
            }
            w={{ base: "100%", sm: 220 }}
          />
        </SettingsFormRow>
        <SettingsFormRow
          label="Custom accent color"
          description="Override the selected theme accent when needed."
        >
          <ColorInput
            value={appearance.customAccentColor}
            placeholder="Use theme accent"
            onChange={appearance.setCustomAccentColor}
            w={{ base: "100%", sm: 220 }}
          />
        </SettingsFormRow>
        <SettingsFormRow
          label="AMOLED black"
          description="Use a pure black background in dark mode."
        >
          <Switch
            checked={appearance.amoledBlack}
            onChange={(event) =>
              appearance.setAmoledBlack(event.currentTarget.checked)
            }
          />
        </SettingsFormRow>
      </SettingsSection>

      <SettingsSection
        title="Localization"
        summary="Language used by app chrome and settings."
      >
        <SettingsFormRow
          label="Locale"
          description="Select the preferred interface language."
        >
          <Select
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
            w={{ base: "100%", sm: 220 }}
          />
        </SettingsFormRow>
      </SettingsSection>

      <SettingsSection
        title="Navigation"
        summary="Control which shell destinations are visible."
      >
        <SettingsFormRow
          label="History tab"
          description="Show the reading history destination in navigation."
        >
          <Switch
            checked={appearance.showHistoryTab}
            onChange={(event) =>
              appearance.setShowHistoryTab(event.currentTarget.checked)
            }
          />
        </SettingsFormRow>
        <SettingsFormRow
          label="Updates tab"
          description="Show the library updates destination in navigation."
        >
          <Switch
            checked={appearance.showUpdatesTab}
            onChange={(event) =>
              appearance.setShowUpdatesTab(event.currentTarget.checked)
            }
          />
        </SettingsFormRow>
        <SettingsFormRow
          label="Navigation labels"
          description="Display text labels next to navigation icons."
        >
          <Switch
            checked={appearance.showLabelsInNav}
            onChange={(event) =>
              appearance.setShowLabelsInNav(event.currentTarget.checked)
            }
          />
        </SettingsFormRow>
        <SettingsFormRow
          label="Reset appearance"
          description="Restore the default app appearance values."
        >
          <Button variant="default" onClick={appearance.resetAppearance}>
            Reset appearance
          </Button>
        </SettingsFormRow>
      </SettingsSection>
    </Stack>
  );
}

function DataSettingsSection({
  isBusy,
  onExport,
  onImport,
  onRunMaintenance,
  onClearStorage,
  onStatusChange,
}: {
  isBusy: boolean;
  onExport: () => void;
  onImport: () => void;
  onRunMaintenance: (
    message: string,
    warning: string,
    action: () => Promise<{ rowsAffected: number }>,
  ) => void;
  onClearStorage: () => void;
  onStatusChange: (status: Status) => void;
}) {
  const userAgent = useUserAgentStore((state) => state.userAgent);
  const setUserAgent = useUserAgentStore((state) => state.setUserAgent);
  const resetUserAgent = useUserAgentStore((state) => state.resetUserAgent);
  const [userAgentInput, setUserAgentInput] = useState(userAgent);

  return (
    <Stack gap="md">
      <SettingsSection
        title="Backup"
        summary="Export or replace the local reader database."
      >
        <SettingsFormRow
          label="Backup file"
          description="Write the current app data to a local backup file."
        >
          <Group className="lnr-settings-actions" gap="xs" justify="flex-end">
            <Button onClick={onExport} loading={isBusy} disabled={isBusy}>
              Export backup
            </Button>
            <Button
              onClick={onImport}
              loading={isBusy}
              disabled={isBusy}
              variant="default"
            >
              Import backup
            </Button>
          </Group>
        </SettingsFormRow>
      </SettingsSection>

      <SettingsSection
        title="Maintenance"
        summary="Clear local caches and derived reader state."
      >
        <SettingsFormRow
          label="Cached novels"
          description="Delete non-library novels and their chapters."
        >
          <Button
            disabled={isBusy}
            loading={isBusy}
            variant="default"
            onClick={() => {
              onRunMaintenance(
                "Clearing cached novels...",
                "Delete all non-library novels and their chapters?",
                clearCachedNovels,
              );
            }}
          >
            Clear cached novels
          </Button>
        </SettingsFormRow>
        <SettingsFormRow
          label="Updates queue"
          description="Mark all current library updates as read."
        >
          <Button
            disabled={isBusy}
            loading={isBusy}
            variant="default"
            onClick={() => {
              onRunMaintenance(
                "Clearing updates...",
                "Mark all current library updates as read?",
                clearUpdatesTab,
              );
            }}
          >
            Clear updates tab
          </Button>
        </SettingsFormRow>
        <SettingsFormRow
          label="Read downloads"
          description="Delete downloaded content for chapters already read."
        >
          <Button
            disabled={isBusy}
            loading={isBusy}
            variant="default"
            onClick={() => {
              onRunMaintenance(
                "Deleting read downloaded chapters...",
                "Delete downloaded content for chapters already marked read?",
                deleteReadDownloadedChapters,
              );
            }}
          >
            Delete read downloads
          </Button>
        </SettingsFormRow>
        <SettingsFormRow
          label="Plugin storage"
          description="Clear app-origin plugin storage and scraper cookies."
        >
          <Button variant="default" onClick={onClearStorage}>
            Clear cookies and plugin storage
          </Button>
        </SettingsFormRow>
      </SettingsSection>

      <SettingsSection
        title="Network identity"
        summary="Default User-Agent sent by plugin requests."
      >
        <SettingsFormRow
          label="Custom User-Agent"
          description="Used when a plugin does not set its own User-Agent header."
        >
          <Textarea
            value={userAgentInput}
            autosize
            minRows={3}
            onChange={(event) => setUserAgentInput(event.currentTarget.value)}
            w={{ base: "100%", sm: 420 }}
          />
        </SettingsFormRow>
        <SettingsFormRow
          label="Save User-Agent"
          description="Persist or restore the default network identity."
        >
          <Group className="lnr-settings-actions" gap="xs" justify="flex-end">
            <Button
              onClick={() => {
                setUserAgent(userAgentInput);
                onStatusChange({ kind: "ok", message: "User-Agent saved." });
              }}
            >
              Save User-Agent
            </Button>
            <Button
              variant="default"
              onClick={() => {
                resetUserAgent();
                setUserAgentInput(DEFAULT_USER_AGENT);
                onStatusChange({
                  kind: "ok",
                  message: "User-Agent reset to default.",
                });
              }}
            >
              Reset
            </Button>
          </Group>
        </SettingsFormRow>
      </SettingsSection>
    </Stack>
  );
}

function AboutSettingsSection({ onOpenRelease }: { onOpenRelease: () => void }) {
  return (
    <Stack gap="md">
      <SettingsSection
        title="Build"
        summary="Release channel and update policy."
      >
        <SettingsFormRow
          label="Version"
          description="The current v0.1 line ships unsigned debug builds."
        >
          <ConsoleChip tone="accent">v0.1</ConsoleChip>
        </SettingsFormRow>
        <SettingsFormRow
          label="Auto-update"
          description="In-app auto-update is intentionally deferred until v0.2."
        >
          <ConsoleChip>Manual release check</ConsoleChip>
        </SettingsFormRow>
      </SettingsSection>

      <SettingsSection
        title="Links"
        summary="Open the project release page outside the app."
      >
        <SettingsFormRow
          label="Latest release"
          description="Open GitHub Releases in the system browser."
        >
          <Group className="lnr-settings-actions" gap="xs" justify="flex-end">
            <Button variant="default" onClick={onOpenRelease}>
              Open latest release
            </Button>
            <Anchor
              href={LATEST_RELEASE_URL}
              target="_blank"
              rel="noreferrer"
              size="sm"
            >
              GitHub Releases
            </Anchor>
          </Group>
        </SettingsFormRow>
      </SettingsSection>
    </Stack>
  );
}

function SettingsCategoryList({
  categories,
  activeId,
  onSelect,
}: {
  categories: readonly SettingsCategory[];
  activeId: SettingsCategoryId;
  onSelect: (id: SettingsCategoryId) => void;
}) {
  return (
    <aside className="lnr-settings-nav" aria-label="Settings navigation">
      <div className="lnr-settings-nav-header">
        <Text className="lnr-console-kicker">Settings</Text>
      </div>
      <ScrollArea className="lnr-settings-nav-scroll">
        <div className="lnr-settings-nav-list">
          {categories.map((category) => {
            const selected = category.id === activeId;
            return (
              <UnstyledButton
                key={category.id}
                aria-current={selected ? "page" : undefined}
                className="lnr-settings-nav-item"
                data-active={selected}
                onClick={() => onSelect(category.id)}
                type="button"
              >
                <span className="lnr-settings-nav-label">
                  {category.title}
                </span>
                <span className="lnr-settings-nav-count">
                  {category.groupCount}
                </span>
              </UnstyledButton>
            );
          })}
        </div>
      </ScrollArea>
      <div className="lnr-settings-nav-footer">v0.1 / Tauri 2</div>
    </aside>
  );
}

function SettingsDetail({
  category,
  onBackToList,
  status,
}: {
  category: SettingsCategory;
  onBackToList: () => void;
  status: Status;
}) {
  return (
    <section
      className="lnr-settings-detail"
      aria-labelledby={`settings-${category.id}-title`}
    >
      <div className="lnr-settings-detail-inner">
        <Text className="lnr-settings-kicker">
          Settings / {category.title}
        </Text>
        <Button
          className="lnr-settings-mobile-back"
          size="xs"
          variant="subtle"
          onClick={onBackToList}
        >
          Back to settings
        </Button>
        <Group
          className="lnr-settings-detail-header"
          align="flex-start"
          justify="space-between"
          wrap="nowrap"
        >
          <Box className="lnr-settings-detail-copy">
            <Title
              className="lnr-settings-detail-title"
              id={`settings-${category.id}-title`}
              order={1}
            >
              {category.title}
            </Title>
            <Text className="lnr-settings-detail-summary">
              {category.summary}
            </Text>
          </Box>
          <Group className="lnr-settings-detail-meta" gap="xs" justify="flex-end">
            <ConsoleChip tone="accent">{category.groupCount} groups</ConsoleChip>
            <ConsoleChip>{category.id}</ConsoleChip>
          </Group>
        </Group>

        <StatusBanner status={status} />

        <Stack className="lnr-settings-detail-body" gap="md">
          {category.content}
        </Stack>
      </div>
    </section>
  );
}

interface SettingsPageProps {
  section?: string;
}

export function SettingsPage({ section }: SettingsPageProps = {}) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [activeSection, setActiveSection] = useState<SettingsCategoryId>(() =>
    normalizeSection(section),
  );
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const isBusy = status.kind === "busy";

  useEffect(() => {
    setActiveSection(normalizeSection(section));
  }, [section]);

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

  function openLatestRelease(): void {
    void openExternal(LATEST_RELEASE_URL).catch((error: unknown) => {
      setStatus({
        kind: "error",
        message: `Failed to open release page: ${describeError(error)}`,
      });
    });
  }

  const categories: SettingsCategory[] = [
    {
      id: "app",
      title: "App",
      summary: "Theme, locale, and navigation.",
      groupCount: 3,
      content: <AppSettingsSection />,
    },
    {
      id: "reader",
      title: "Reader",
      summary: "Typography, paging, controls, and advanced overrides.",
      groupCount: 6,
      content: (
        <SettingsSection
          title="Reader preferences"
          summary="Reading mode, text, controls, indicators, automation, and advanced overrides."
        >
          <ReaderSettingsPanel />
        </SettingsSection>
      ),
    },
    {
      id: "library",
      title: "Library",
      summary: "Display, sorting, badges, and reading scope.",
      groupCount: 1,
      content: (
        <SettingsSection
          title="Library preferences"
          summary="Library display, sorting, badges, and reading scope."
        >
          <LibrarySettingsPanel />
        </SettingsSection>
      ),
    },
    {
      id: "browse",
      title: "Browse",
      summary: "Plugin languages, global search, and pinned sources.",
      groupCount: 1,
      content: (
        <SettingsSection
          title="Browse preferences"
          summary="Plugin language filtering, global search, and pinned sources."
        >
          <BrowseSettingsPanel />
        </SettingsSection>
      ),
    },
    {
      id: "data",
      title: "Data",
      summary: "Backup, maintenance, plugin storage, and network identity.",
      groupCount: 3,
      content: (
        <DataSettingsSection
          isBusy={isBusy}
          onExport={() => {
            void handleExport();
          }}
          onImport={() => {
            void handleImport();
          }}
          onRunMaintenance={(message, warning, action) => {
            void runMaintenance(message, warning, action);
          }}
          onClearStorage={() => {
            void handleClearStorage();
          }}
          onStatusChange={setStatus}
        />
      ),
    },
    {
      id: "about",
      title: "About",
      summary: "Version, release policy, and project links.",
      groupCount: 2,
      content: <AboutSettingsSection onOpenRelease={openLatestRelease} />,
    },
  ];

  const activeCategory =
    categories.find((category) => category.id === activeSection) ??
    categories[0];

  const selectCategory = (id: SettingsCategoryId) => {
    setActiveSection(id);
    setMobileDetailOpen(true);
  };

  return (
    <PageFrame className="lnr-settings-page" size="full">
      <div
        className="lnr-settings-shell"
        data-mobile-detail-open={mobileDetailOpen}
      >
        <SettingsCategoryList
          activeId={activeCategory.id}
          categories={categories}
          onSelect={selectCategory}
        />
        <SettingsDetail
          category={activeCategory}
          onBackToList={() => setMobileDetailOpen(false)}
          status={status}
        />
      </div>
      <ConsoleStatusStrip className="lnr-settings-strip">
        <span>{categories.length} sections</span>
        <span>Selected: {activeCategory.title}</span>
        <span>{status.kind === "idle" ? "Idle" : status.message}</span>
      </ConsoleStatusStrip>
    </PageFrame>
  );
}
