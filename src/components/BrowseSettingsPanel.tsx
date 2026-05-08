import {
  NumberInput,
  Stack,
} from "@mantine/core";
import { SettingsFieldRow, SettingsSection } from "./SettingsPrimitives";
import { useTranslation } from "../i18n";
import { useBrowseStore } from "../store/browse";

export function BrowseSettingsPanel() {
  const { t } = useTranslation();
  const globalSearchConcurrency = useBrowseStore(
    (s) => s.globalSearchConcurrency,
  );
  const setGlobalSearchConcurrency = useBrowseStore(
    (s) => s.setGlobalSearchConcurrency,
  );
  const globalSearchTimeoutSeconds = useBrowseStore(
    (s) => s.globalSearchTimeoutSeconds,
  );
  const setGlobalSearchTimeoutSeconds = useBrowseStore(
    (s) => s.setGlobalSearchTimeoutSeconds,
  );
  const chapterDownloadCooldownSeconds = useBrowseStore(
    (s) => s.chapterDownloadCooldownSeconds,
  );
  const setChapterDownloadCooldownSeconds = useBrowseStore(
    (s) => s.setChapterDownloadCooldownSeconds,
  );

  return (
    <Stack gap="md">
      <SettingsSection title={t("browseSettings.group.search")}>
        <SettingsFieldRow
          label={t("browseSettings.globalSearchConcurrency")}
          description={t("browseSettings.globalSearchConcurrency.description")}
        >
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
          label={t("browseSettings.globalSearchTimeout")}
          description={t("browseSettings.globalSearchTimeout.description")}
        >
          <NumberInput
            value={globalSearchTimeoutSeconds}
            min={5}
            max={120}
            step={5}
            clampBehavior="strict"
            suffix={` ${t("common.seconds")}`}
            onChange={(value) => {
              if (typeof value === "number") {
                setGlobalSearchTimeoutSeconds(value);
              }
            }}
          />
        </SettingsFieldRow>
      </SettingsSection>

      <SettingsSection title={t("browseSettings.group.downloads")}>
        <SettingsFieldRow
          label={t("browseSettings.chapterDownloadCooldown")}
          description={t("browseSettings.chapterDownloadCooldown.description")}
        >
          <NumberInput
            value={chapterDownloadCooldownSeconds}
            min={0}
            max={60}
            step={1}
            clampBehavior="strict"
            suffix={` ${t("common.seconds")}`}
            onChange={(value) => {
              if (typeof value === "number") {
                setChapterDownloadCooldownSeconds(value);
              }
            }}
          />
        </SettingsFieldRow>
      </SettingsSection>
    </Stack>
  );
}
