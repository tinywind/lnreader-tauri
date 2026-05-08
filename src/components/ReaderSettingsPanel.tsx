import { useMemo } from "react";
import {
  ColorInput,
  NumberInput,
  Select,
  SimpleGrid,
  Slider,
  Stack,
  Switch,
  Tabs,
  Text,
  Textarea,
  UnstyledButton,
} from "@mantine/core";
import { SegmentedToggle } from "./SegmentedToggle";
import {
  SettingsFieldRow,
  SettingsInlineControls,
  SettingsSection,
  SettingsWideField,
} from "./SettingsPrimitives";
import { TextButton } from "./TextButton";
import { useTranslation, type TranslationKey } from "../i18n";
import {
  READER_TAP_PRESETS,
  READER_TAP_ZONES,
  READER_FONT_OPTIONS,
  READER_PRESET_THEMES,
  useReaderStore,
  type ReaderTapAction,
  type ReaderTapPreset,
  type ReaderTapPresetId,
} from "../store/reader";
import "../styles/settings.css";

const TAP_ACTION_LABEL_KEYS: Record<ReaderTapAction, TranslationKey> = {
  none: "readerSettings.tapAction.none",
  previous: "readerSettings.tapAction.previous",
  menu: "readerSettings.tapAction.menu",
  next: "readerSettings.tapAction.next",
};

const READER_THEME_LABEL_KEYS: Record<string, TranslationKey> = {
  paper: "readerSettings.theme.paper",
  sepia: "readerSettings.theme.sepia",
  sage: "readerSettings.theme.sage",
  dark: "readerSettings.theme.dark",
  amoled: "readerSettings.theme.amoled",
};

type ReaderModeOption = "scroll" | "paged" | "two-page";

export function ReaderSettingsPanel() {
  const { t } = useTranslation();
  const general = useReaderStore((state) => state.general);
  const appearance = useReaderStore((state) => state.appearance);
  const setGeneral = useReaderStore((state) => state.setGeneral);
  const setAppearance = useReaderStore((state) => state.setAppearance);
  const applyTheme = useReaderStore((state) => state.applyTheme);
  const saveCustomTheme = useReaderStore((state) => state.saveCustomTheme);
  const resetReaderSettings = useReaderStore(
    (state) => state.resetReaderSettings,
  );
  const applyTapZonePreset = useReaderStore(
    (state) => state.applyTapZonePreset,
  );

  const readerThemes = useMemo(
    () => [...READER_PRESET_THEMES, ...appearance.customThemes],
    [appearance.customThemes],
  );
  const readerMode: ReaderModeOption = general.pageReader
    ? general.twoPageReader
      ? "two-page"
      : "paged"
    : "scroll";

  function handleSaveCustomTheme(): void {
    const id = `custom-${Date.now()}`;
    saveCustomTheme({
      id,
      label: t("readerSettings.customThemeName", {
        number: appearance.customThemes.length + 1,
      }),
      backgroundColor: appearance.backgroundColor,
      textColor: appearance.textColor,
    });
    setAppearance({ themeId: id });
  }

  return (
    <Tabs
      className="lnr-reader-settings-tabs"
      defaultValue="reading"
      keepMounted={false}
    >
      <Tabs.List className="lnr-reader-settings-tab-list">
        <Tabs.Tab value="reading">
          {t("readerSettings.reading.title")}
        </Tabs.Tab>
        <Tabs.Tab value="text">{t("readerSettings.text.title")}</Tabs.Tab>
        <Tabs.Tab value="controls">
          {t("readerSettings.controls.title")}
        </Tabs.Tab>
        <Tabs.Tab value="indicators">
          {t("readerSettings.indicators.title")}
        </Tabs.Tab>
        <Tabs.Tab value="advanced">{t("readerSettings.advanced")}</Tabs.Tab>
      </Tabs.List>

      <Tabs.Panel className="lnr-reader-settings-tab-panel" value="reading">
        <Stack gap="lg">
      <SettingsSection
        title={t("readerSettings.reading.title")}
      >
        <SettingsFieldRow
          label={t("readerSettings.readingMode")}
          description={t("readerSettings.readingMode.description")}
        >
          <SegmentedToggle
            data={[
              { value: "scroll", label: t("readerSettings.scroll") },
              { value: "paged", label: t("readerSettings.paged") },
              { value: "two-page", label: t("readerSettings.twoPage") },
            ]}
            value={readerMode}
            onChange={(value) => {
              switch (value) {
                case "two-page":
                  setGeneral({
                    autoScroll: false,
                    pageReader: true,
                    twoPageReader: true,
                  });
                  break;
                case "paged":
                  setGeneral({
                    autoScroll: false,
                    pageReader: true,
                    twoPageReader: false,
                  });
                  break;
                default:
                  setGeneral({ pageReader: false, twoPageReader: false });
                  break;
              }
            }}
          />
        </SettingsFieldRow>
        <SettingsFieldRow
          label={t("readerSettings.autoScroll")}
          description={t("readerSettings.autoScroll.description")}
        >
          <Switch
            checked={!general.pageReader && general.autoScroll}
            disabled={general.pageReader}
            onChange={(event) =>
              setGeneral({ autoScroll: event.currentTarget.checked })
            }
          />
        </SettingsFieldRow>
        {!general.pageReader && general.autoScroll ? (
          <>
            <SettingsFieldRow
              label={t("readerSettings.autoScrollInterval")}
              description={t("readerSettings.autoScrollInterval.description")}
            >
              <NumberInput
                value={general.autoScrollInterval}
                min={16}
                max={500}
                onChange={(value) => {
                  if (typeof value === "number") {
                    setGeneral({ autoScrollInterval: value });
                  }
                }}
              />
            </SettingsFieldRow>
            <SettingsFieldRow
              label={t("readerSettings.autoScrollOffset")}
              description={t("readerSettings.autoScrollOffset.description")}
            >
              <NumberInput
                value={general.autoScrollOffset}
                min={0.25}
                max={12}
                step={0.25}
                onChange={(value) => {
                  if (typeof value === "number") {
                    setGeneral({ autoScrollOffset: value });
                  }
                }}
              />
            </SettingsFieldRow>
          </>
        ) : null}
        <SettingsFieldRow
          label={t("readerSettings.fullPageReader")}
          description={t("readerSettings.fullPageReader.description")}
        >
          <Switch
            checked={general.fullPageReader}
            onChange={(event) =>
              setGeneral({ fullPageReader: event.currentTarget.checked })
            }
          />
        </SettingsFieldRow>
        <SettingsFieldRow
          label={t("readerSettings.keepScreenOn")}
          description={t("readerSettings.keepScreenOn.description")}
        >
          <Switch
            checked={general.keepScreenOn}
            onChange={(event) =>
              setGeneral({ keepScreenOn: event.currentTarget.checked })
            }
          />
        </SettingsFieldRow>
      </SettingsSection>
        </Stack>
      </Tabs.Panel>

      <Tabs.Panel className="lnr-reader-settings-tab-panel" value="text">
        <Stack gap="lg">
      <SettingsSection
        title={t("readerSettings.text.title")}
      >
        <SettingsFieldRow
          label={t("readerSettings.readerTheme")}
          description={t("readerSettings.readerTheme.description")}
        >
          <Select
            data={readerThemes.map((theme) => ({
              value: theme.id,
              label: getReaderThemeLabel(theme.id, theme.label, t),
            }))}
            value={appearance.themeId}
            onChange={(themeId) => {
              const nextTheme = readerThemes.find(
                (theme) => theme.id === themeId,
              );
              if (nextTheme) applyTheme(nextTheme);
            }}
          />
        </SettingsFieldRow>
        <SettingsFieldRow
          label={t("readerSettings.background")}
          description={t("readerSettings.background.description")}
        >
          <ColorInput
            value={appearance.backgroundColor}
            onChange={(backgroundColor) =>
              setAppearance({ backgroundColor })
            }
          />
        </SettingsFieldRow>
        <SettingsFieldRow
          label={t("readerSettings.textColor")}
          description={t("readerSettings.textColor.description")}
        >
          <ColorInput
            value={appearance.textColor}
            onChange={(textColor) => setAppearance({ textColor })}
          />
        </SettingsFieldRow>
        <SettingSlider
          label={t("readerSettings.textSize")}
          description={t("readerSettings.textSize.description")}
          valueLabel={`${appearance.textSize}px`}
          min={12}
          max={36}
          step={1}
          value={appearance.textSize}
          onChange={(textSize) => setAppearance({ textSize })}
        />
        <SettingSlider
          label={t("readerSettings.lineHeight")}
          description={t("readerSettings.lineHeight.description")}
          valueLabel={appearance.lineHeight.toFixed(2)}
          min={1}
          max={2.6}
          step={0.05}
          value={appearance.lineHeight}
          onChange={(lineHeight) => setAppearance({ lineHeight })}
        />
        <SettingSlider
          label={t("readerSettings.padding")}
          description={t("readerSettings.padding.description")}
          valueLabel={`${appearance.padding}px`}
          min={0}
          max={64}
          step={1}
          value={appearance.padding}
          onChange={(padding) => setAppearance({ padding })}
        />
        <SettingsFieldRow
          label={t("readerSettings.font")}
          description={t("readerSettings.font.description")}
        >
          <Select
            data={READER_FONT_OPTIONS.map((option) => ({
              ...option,
              label:
                option.value === ""
                  ? t("readerSettings.font.original")
                  : option.label,
            }))}
            value={appearance.fontFamily}
            onChange={(fontFamily) =>
              setAppearance({ fontFamily: fontFamily ?? "" })
            }
          />
        </SettingsFieldRow>
        <SettingsFieldRow
          label={t("readerSettings.alignment")}
          description={t("readerSettings.alignment.description")}
        >
          <SegmentedToggle
            value={appearance.textAlign}
            onChange={(textAlign) =>
              setAppearance({
                textAlign: textAlign as typeof appearance.textAlign,
              })
            }
            data={[
              { value: "left", label: t("readerSettings.align.left") },
              {
                value: "justify",
                label: t("readerSettings.align.justify"),
              },
              { value: "center", label: t("readerSettings.align.center") },
              { value: "right", label: t("readerSettings.align.right") },
            ]}
          />
        </SettingsFieldRow>
        <SettingsFieldRow
          label={t("readerSettings.actions")}
          description={t("readerSettings.actions.description")}
        >
          <SettingsInlineControls>
            <TextButton variant="default" onClick={handleSaveCustomTheme}>
              {t("readerSettings.saveCustomTheme")}
            </TextButton>
            <TextButton variant="default" onClick={resetReaderSettings}>
              {t("common.reset")}
            </TextButton>
          </SettingsInlineControls>
        </SettingsFieldRow>
      </SettingsSection>
        </Stack>
      </Tabs.Panel>

      <Tabs.Panel className="lnr-reader-settings-tab-panel" value="controls">
        <Stack gap="lg">
      <SettingsSection
        title={t("readerSettings.controls.title")}
      >
        <SettingsFieldRow
          label={t("readerSettings.swipeGestures")}
          description={t("readerSettings.swipeGestures.description")}
        >
          <Switch
            checked={general.swipeGestures}
            onChange={(event) =>
              setGeneral({ swipeGestures: event.currentTarget.checked })
            }
          />
        </SettingsFieldRow>
        <SettingsFieldRow
          label={t("readerSettings.tapControls")}
          description={t("readerSettings.tapControls.description")}
        >
          <Switch
            checked={general.tapToScroll}
            onChange={(event) =>
              setGeneral({ tapToScroll: event.currentTarget.checked })
            }
          />
        </SettingsFieldRow>
        {general.tapToScroll ? (
          <SettingsFieldRow
            label={t("readerSettings.tapPreset")}
            description={t("readerSettings.tapPreset.description")}
            layout="stacked"
          >
            <SettingsWideField>
              <div className="lnr-reader-tap-preset-grid">
                {READER_TAP_PRESETS.map((preset, index) => (
                  <TapZonePresetCard
                    key={preset.id}
                    index={index}
                    preset={preset}
                    selected={preset.id === general.tapZonePresetId}
                    onApply={applyTapZonePreset}
                  />
                ))}
              </div>
            </SettingsWideField>
          </SettingsFieldRow>
        ) : null}
      </SettingsSection>
        </Stack>
      </Tabs.Panel>

      <Tabs.Panel className="lnr-reader-settings-tab-panel" value="indicators">
        <Stack gap="lg">
      <SettingsSection
        title={t("readerSettings.indicators.title")}
      >
        <SettingsFieldRow
          label={t("readerSettings.seekbar")}
          description={t("readerSettings.seekbar.description")}
        >
          <Switch
            checked={general.showSeekbar}
            onChange={(event) =>
              setGeneral({ showSeekbar: event.currentTarget.checked })
            }
          />
        </SettingsFieldRow>
        {general.showSeekbar ? (
          <SettingsFieldRow
            label={t("readerSettings.verticalSeekbar")}
            description={t("readerSettings.verticalSeekbar.description")}
          >
            <Switch
              checked={general.verticalSeekbar}
              onChange={(event) =>
                setGeneral({ verticalSeekbar: event.currentTarget.checked })
              }
            />
          </SettingsFieldRow>
        ) : null}
        <SettingsFieldRow
          label={t("readerSettings.scrollPercentage")}
          description={t("readerSettings.scrollPercentage.description")}
        >
          <Switch
            checked={general.showScrollPercentage}
            onChange={(event) =>
              setGeneral({
                showScrollPercentage: event.currentTarget.checked,
              })
            }
          />
        </SettingsFieldRow>
        <SettingsFieldRow
          label={t("readerSettings.batteryTimeFooter")}
          description={t("readerSettings.batteryTimeFooter.description")}
        >
          <Switch
            checked={general.showBatteryAndTime}
            onChange={(event) =>
              setGeneral({
                showBatteryAndTime: event.currentTarget.checked,
              })
            }
          />
        </SettingsFieldRow>
      </SettingsSection>
        </Stack>
      </Tabs.Panel>

      <Tabs.Panel className="lnr-reader-settings-tab-panel" value="advanced">
        <Stack gap="lg">
          <SettingsSection title={t("readerSettings.advanced")}>
            <Stack gap="md">
              <SettingsFieldRow
                label={t("readerSettings.bionicReading")}
                description={t("readerSettings.bionicReading.description")}
              >
                <Switch
                  checked={general.bionicReading}
                  onChange={(event) =>
                    setGeneral({ bionicReading: event.currentTarget.checked })
                  }
                />
              </SettingsFieldRow>
              <SettingsFieldRow
                label={t("readerSettings.removeExtraParagraphSpacing")}
                description={t(
                  "readerSettings.removeExtraParagraphSpacing.description",
                )}
              >
                <Switch
                  checked={general.removeExtraParagraphSpacing}
                  onChange={(event) =>
                    setGeneral({
                      removeExtraParagraphSpacing:
                        event.currentTarget.checked,
                    })
                  }
                />
              </SettingsFieldRow>
              <SettingsFieldRow
                label={t("readerSettings.customCss")}
                description={t("readerSettings.customCss.description")}
                layout="stacked"
              >
                <SettingsWideField>
                  <Textarea
                    value={appearance.customCss}
                    autosize
                    minRows={5}
                    onChange={(event) =>
                      setAppearance({ customCss: event.currentTarget.value })
                    }
                  />
                </SettingsWideField>
              </SettingsFieldRow>
              <SettingsFieldRow
                label={t("readerSettings.customJs")}
                description={t("readerSettings.customJs.description")}
                layout="stacked"
              >
                <SettingsWideField>
                  <Textarea
                    value={appearance.customJs}
                    autosize
                    minRows={5}
                    onChange={(event) =>
                      setAppearance({ customJs: event.currentTarget.value })
                    }
                  />
                </SettingsWideField>
              </SettingsFieldRow>
            </Stack>
          </SettingsSection>
        </Stack>
      </Tabs.Panel>
    </Tabs>
  );
}

function SettingSlider({
  label,
  description,
  valueLabel,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  description: string;
  valueLabel: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <SettingsFieldRow label={label} description={description}>
      <div className="lnr-settings-slider-control">
        <Text className="lnr-settings-slider-value">{valueLabel}</Text>
        <Slider
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={onChange}
        />
      </div>
    </SettingsFieldRow>
  );
}

function TapZonePresetCard({
  index,
  preset,
  selected,
  onApply,
}: {
  index: number;
  preset: ReaderTapPreset;
  selected: boolean;
  onApply: (presetId: ReaderTapPresetId) => void;
}) {
  const { t } = useTranslation();

  return (
    <UnstyledButton
      aria-label={`${t("readerSettings.tapControls")} ${index + 1}`}
      aria-pressed={selected}
      className="lnr-reader-tap-preset"
      data-selected={selected}
      onClick={() => onApply(preset.id)}
      type="button"
    >
      <TapZonePreview preset={preset} />
    </UnstyledButton>
  );
}

function TapZonePreview({ preset }: { preset: ReaderTapPreset }) {
  const { t } = useTranslation();
  const actions = READER_TAP_ZONES.map((zone) => preset.zones[zone]);

  return (
    <SimpleGrid cols={3} spacing={4}>
      {actions.map((action, index) => (
        <Text
          key={`${preset.id}-${index}`}
          size="xs"
          ta="center"
          fw={600}
          style={{
            border: "1px solid var(--mantine-color-default-border)",
            borderRadius: "0.25rem",
            padding: "0.5rem 0.25rem",
            background: getTapActionBackground(action),
            color: getTapActionColor(action),
          }}
        >
          {t(TAP_ACTION_LABEL_KEYS[action])}
        </Text>
      ))}
    </SimpleGrid>
  );
}

function getReaderThemeLabel(
  themeId: string,
  fallback: string,
  t: (key: TranslationKey) => string,
): string {
  const key = READER_THEME_LABEL_KEYS[themeId];
  return key ? t(key) : fallback;
}

function getTapActionBackground(action: ReaderTapAction): string {
  switch (action) {
    case "previous":
      return "var(--mantine-color-blue-0)";
    case "next":
      return "var(--mantine-color-teal-0)";
    case "menu":
      return "var(--mantine-color-yellow-0)";
    case "none":
      return "var(--mantine-color-gray-0)";
  }
}

function getTapActionColor(action: ReaderTapAction): string {
  switch (action) {
    case "previous":
      return "var(--mantine-color-blue-9)";
    case "next":
      return "var(--mantine-color-teal-9)";
    case "menu":
      return "var(--mantine-color-yellow-9)";
    case "none":
      return "var(--mantine-color-gray-7)";
  }
}
