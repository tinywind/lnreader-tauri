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
import { BackIconButton } from "../components/BackIconButton";
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
import { SUPPORTED_APP_LOCALES, useTranslation } from "../i18n";
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
  const { t } = useTranslation();

  if (status.kind === "ok") {
    return (
      <StateView
        color="green"
        title={t("settings.updatedTitle")}
        message={status.message}
      />
    );
  }
  if (status.kind === "error") {
    return (
      <StateView
        color="red"
        title={t("settings.errorTitle")}
        message={status.message}
      />
    );
  }
  if (status.kind === "busy") {
    return (
      <StateView
        color="blue"
        title={t("settings.workingTitle")}
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
  const { t } = useTranslation();

  return (
    <Stack gap="md">
      <SettingsSection
        title={t("settings.app.appearance.title")}
        summary={t("settings.app.appearance.summary")}
      >
        <SettingsFormRow
          label={t("settings.app.themeMode.label")}
          description={t("settings.app.themeMode.description")}
        >
          <Select
            data={[
              { value: "system", label: t("settings.app.themeMode.system") },
              { value: "light", label: t("settings.app.themeMode.light") },
              { value: "dark", label: t("settings.app.themeMode.dark") },
            ]}
            value={appearance.themeMode}
            onChange={(themeMode) =>
              appearance.setThemeMode((themeMode ?? "system") as AppThemeMode)
            }
            w={{ base: "100%", sm: 220 }}
          />
        </SettingsFormRow>
        <SettingsFormRow
          label={t("settings.app.appTheme.label")}
          description={t("settings.app.appTheme.description")}
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
          label={t("settings.app.customAccent.label")}
          description={t("settings.app.customAccent.description")}
        >
          <ColorInput
            value={appearance.customAccentColor}
            placeholder={t("settings.app.customAccent.placeholder")}
            onChange={appearance.setCustomAccentColor}
            w={{ base: "100%", sm: 220 }}
          />
        </SettingsFormRow>
        <SettingsFormRow
          label={t("settings.app.amoled.label")}
          description={t("settings.app.amoled.description")}
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
        title={t("settings.app.localization.title")}
        summary={t("settings.app.localization.summary")}
      >
        <SettingsFormRow
          label={t("settings.app.locale.label")}
          description={t("settings.app.locale.description")}
        >
          <Select
            data={SUPPORTED_APP_LOCALES.map((locale) => ({
              value: locale,
              label: t(locale === "ko" ? "locale.ko" : "locale.en"),
            }))}
            value={appearance.appLocale}
            onChange={(appLocale) =>
              appearance.setAppLocale(appLocale ?? DEFAULT_APPEARANCE.appLocale)
            }
            w={{ base: "100%", sm: 220 }}
          />
        </SettingsFormRow>
      </SettingsSection>

      <SettingsSection
        title={t("settings.app.navigation.title")}
        summary={t("settings.app.navigation.summary")}
      >
        <SettingsFormRow
          label={t("settings.app.historyTab.label")}
          description={t("settings.app.historyTab.description")}
        >
          <Switch
            checked={appearance.showHistoryTab}
            onChange={(event) =>
              appearance.setShowHistoryTab(event.currentTarget.checked)
            }
          />
        </SettingsFormRow>
        <SettingsFormRow
          label={t("settings.app.updatesTab.label")}
          description={t("settings.app.updatesTab.description")}
        >
          <Switch
            checked={appearance.showUpdatesTab}
            onChange={(event) =>
              appearance.setShowUpdatesTab(event.currentTarget.checked)
            }
          />
        </SettingsFormRow>
        <SettingsFormRow
          label={t("settings.app.navLabels.label")}
          description={t("settings.app.navLabels.description")}
        >
          <Switch
            checked={appearance.showLabelsInNav}
            onChange={(event) =>
              appearance.setShowLabelsInNav(event.currentTarget.checked)
            }
          />
        </SettingsFormRow>
        <SettingsFormRow
          label={t("settings.app.reset.label")}
          description={t("settings.app.reset.description")}
        >
          <Button variant="default" onClick={appearance.resetAppearance}>
            {t("settings.app.reset.button")}
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
  const { t } = useTranslation();
  const userAgent = useUserAgentStore((state) => state.userAgent);
  const setUserAgent = useUserAgentStore((state) => state.setUserAgent);
  const resetUserAgent = useUserAgentStore((state) => state.resetUserAgent);
  const [userAgentInput, setUserAgentInput] = useState(userAgent);

  return (
    <Stack gap="md">
      <SettingsSection
        title={t("settings.data.backup.title")}
        summary={t("settings.data.backup.summary")}
      >
        <SettingsFormRow
          label={t("settings.data.backupFile.label")}
          description={t("settings.data.backupFile.description")}
        >
          <Group className="lnr-settings-actions" gap="xs" justify="flex-end">
            <Button onClick={onExport} loading={isBusy} disabled={isBusy}>
              {t("settings.data.exportBackup")}
            </Button>
            <Button
              onClick={onImport}
              loading={isBusy}
              disabled={isBusy}
              variant="default"
            >
              {t("settings.data.importBackup")}
            </Button>
          </Group>
        </SettingsFormRow>
      </SettingsSection>

      <SettingsSection
        title={t("settings.data.maintenance.title")}
        summary={t("settings.data.maintenance.summary")}
      >
        <SettingsFormRow
          label={t("settings.data.cachedNovels.label")}
          description={t("settings.data.cachedNovels.description")}
        >
          <Button
            disabled={isBusy}
            loading={isBusy}
            variant="default"
            onClick={() => {
              onRunMaintenance(
                t("settings.data.cachedNovels.busy"),
                t("settings.data.cachedNovels.warning"),
                clearCachedNovels,
              );
            }}
          >
            {t("settings.data.cachedNovels.button")}
          </Button>
        </SettingsFormRow>
        <SettingsFormRow
          label={t("settings.data.updatesQueue.label")}
          description={t("settings.data.updatesQueue.description")}
        >
          <Button
            disabled={isBusy}
            loading={isBusy}
            variant="default"
            onClick={() => {
              onRunMaintenance(
                t("settings.data.updatesQueue.busy"),
                t("settings.data.updatesQueue.warning"),
                clearUpdatesTab,
              );
            }}
          >
            {t("settings.data.updatesQueue.button")}
          </Button>
        </SettingsFormRow>
        <SettingsFormRow
          label={t("settings.data.readDownloads.label")}
          description={t("settings.data.readDownloads.description")}
        >
          <Button
            disabled={isBusy}
            loading={isBusy}
            variant="default"
            onClick={() => {
              onRunMaintenance(
                t("settings.data.readDownloads.busy"),
                t("settings.data.readDownloads.warning"),
                deleteReadDownloadedChapters,
              );
            }}
          >
            {t("settings.data.readDownloads.button")}
          </Button>
        </SettingsFormRow>
        <SettingsFormRow
          label={t("settings.data.pluginStorage.label")}
          description={t("settings.data.pluginStorage.description")}
        >
          <Button variant="default" onClick={onClearStorage}>
            {t("settings.data.pluginStorage.button")}
          </Button>
        </SettingsFormRow>
      </SettingsSection>

      <SettingsSection
        title={t("settings.data.network.title")}
        summary={t("settings.data.network.summary")}
      >
        <SettingsFormRow
          label={t("settings.data.userAgent.label")}
          description={t("settings.data.userAgent.description")}
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
          label={t("settings.data.saveUserAgent.label")}
          description={t("settings.data.saveUserAgent.description")}
        >
          <Group className="lnr-settings-actions" gap="xs" justify="flex-end">
            <Button
              onClick={() => {
                setUserAgent(userAgentInput);
                onStatusChange({
                  kind: "ok",
                  message: t("settings.data.userAgentSaved"),
                });
              }}
            >
              {t("settings.data.saveUserAgent.button")}
            </Button>
            <Button
              variant="default"
              onClick={() => {
                resetUserAgent();
                setUserAgentInput(DEFAULT_USER_AGENT);
                onStatusChange({
                  kind: "ok",
                  message: t("settings.data.userAgentReset"),
                });
              }}
            >
              {t("common.reset")}
            </Button>
          </Group>
        </SettingsFormRow>
      </SettingsSection>
    </Stack>
  );
}

function AboutSettingsSection({ onOpenRelease }: { onOpenRelease: () => void }) {
  const { t } = useTranslation();

  return (
    <Stack gap="md">
      <SettingsSection
        title={t("settings.about.build.title")}
        summary={t("settings.about.build.summary")}
      >
        <SettingsFormRow
          label={t("settings.about.version.label")}
          description={t("settings.about.version.description")}
        >
          <ConsoleChip tone="accent">v0.1</ConsoleChip>
        </SettingsFormRow>
        <SettingsFormRow
          label={t("settings.about.autoUpdate.label")}
          description={t("settings.about.autoUpdate.description")}
        >
          <ConsoleChip>{t("settings.about.manualReleaseCheck")}</ConsoleChip>
        </SettingsFormRow>
      </SettingsSection>

      <SettingsSection
        title={t("settings.about.links.title")}
        summary={t("settings.about.links.summary")}
      >
        <SettingsFormRow
          label={t("settings.about.latestRelease.label")}
          description={t("settings.about.latestRelease.description")}
        >
          <Group className="lnr-settings-actions" gap="xs" justify="flex-end">
            <Button variant="default" onClick={onOpenRelease}>
              {t("settings.about.openLatestRelease")}
            </Button>
            <Anchor
              href={LATEST_RELEASE_URL}
              target="_blank"
              rel="noreferrer"
              size="sm"
            >
              {t("settings.about.githubReleases")}
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
  const { t } = useTranslation();

  return (
    <aside className="lnr-settings-nav" aria-label={t("settings.title")}>
      <div className="lnr-settings-nav-header">
        <Text className="lnr-console-kicker">{t("settings.title")}</Text>
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
  const { t } = useTranslation();

  return (
    <section
      className="lnr-settings-detail"
      aria-labelledby={`settings-${category.id}-title`}
    >
      <div className="lnr-settings-detail-inner">
        <Text className="lnr-settings-kicker">
          {t("settings.breadcrumb", { title: category.title })}
        </Text>
        <BackIconButton
          className="lnr-settings-mobile-back"
          label={t("settings.backToSettings")}
          onClick={onBackToList}
        />
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
            <ConsoleChip tone="accent">
              {t("settings.groups", { count: category.groupCount })}
            </ConsoleChip>
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
  const { t } = useTranslation();
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
    setStatus({ kind: "busy", message: t("settings.data.savingBackup") });
    try {
      const path = await exportBackupToFile();
      setStatus(
        path
          ? {
              kind: "ok",
              message: t("settings.data.backupSaved", { path }),
            }
          : { kind: "idle" },
      );
    } catch (error) {
      setStatus({
        kind: "error",
        message: t("settings.data.exportFailed", {
          error: describeError(error),
        }),
      });
    }
  }

  async function handleImport(): Promise<void> {
    if (!window.confirm(t("settings.data.restoreWarning"))) {
      return;
    }
    setStatus({ kind: "busy", message: t("settings.data.restoringBackup") });
    try {
      const path = await importBackupFromFile();
      setStatus(
        path
          ? {
              kind: "ok",
              message: t("settings.data.restoredBackup", { path }),
            }
          : { kind: "idle" },
      );
    } catch (error) {
      setStatus({
        kind: "error",
        message: t("settings.data.restoreFailed", {
          error: describeError(error),
        }),
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
        message: t("settings.data.maintenanceDone", {
          rows: result.rowsAffected,
        }),
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message: `${message} ${t("settings.data.maintenanceFailed", {
          error: describeError(error),
        })}`,
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
    setStatus({ kind: "busy", message: t("settings.data.clearStorageBusy") });
    try {
      const webviewCookieCount = await invoke<number>("scraper_clear_cookies");
      setStatus({
        kind: "ok",
        message: t("settings.data.clearStorageOk", {
          cookieCount,
          storageCount: localCount + sessionCount,
          webviewCookieCount,
        }),
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message: t("settings.data.clearStoragePartial", {
          cookieCount,
          error: describeError(error),
          storageCount: localCount + sessionCount,
        }),
      });
    }
  }

  function openLatestRelease(): void {
    void openExternal(LATEST_RELEASE_URL).catch((error: unknown) => {
      setStatus({
        kind: "error",
        message: t("settings.data.openReleaseFailed", {
          error: describeError(error),
        }),
      });
    });
  }

  const categories: SettingsCategory[] = [
    {
      id: "app",
      title: t("settings.category.app.title"),
      summary: t("settings.category.app.summary"),
      groupCount: 3,
      content: <AppSettingsSection />,
    },
    {
      id: "reader",
      title: t("settings.category.reader.title"),
      summary: t("settings.category.reader.summary"),
      groupCount: 6,
      content: (
        <SettingsSection
          title={t("settings.reader.preferences.title")}
          summary={t("settings.reader.preferences.summary")}
        >
          <ReaderSettingsPanel />
        </SettingsSection>
      ),
    },
    {
      id: "library",
      title: t("settings.category.library.title"),
      summary: t("settings.category.library.summary"),
      groupCount: 1,
      content: (
        <SettingsSection
          title={t("settings.library.preferences.title")}
          summary={t("settings.library.preferences.summary")}
        >
          <LibrarySettingsPanel />
        </SettingsSection>
      ),
    },
    {
      id: "browse",
      title: t("settings.category.browse.title"),
      summary: t("settings.category.browse.summary"),
      groupCount: 1,
      content: (
        <SettingsSection
          title={t("settings.browse.preferences.title")}
          summary={t("settings.browse.preferences.summary")}
        >
          <BrowseSettingsPanel />
        </SettingsSection>
      ),
    },
    {
      id: "data",
      title: t("settings.category.data.title"),
      summary: t("settings.category.data.summary"),
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
      title: t("settings.category.about.title"),
      summary: t("settings.category.about.summary"),
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
        <span>{t("settings.sections", { count: categories.length })}</span>
        <span>{t("settings.selected", { title: activeCategory.title })}</span>
        <span>{status.kind === "idle" ? t("settings.idle") : status.message}</span>
      </ConsoleStatusStrip>
    </PageFrame>
  );
}
