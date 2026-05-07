import {
  NumberInput,
  Stack,
} from "@mantine/core";
import { SettingsFieldRow } from "./SettingsPrimitives";
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
      <SettingsFieldRow label={t("browseSettings.globalSearchTimeout")}>
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
    </Stack>
  );
}
