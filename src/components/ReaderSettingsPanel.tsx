import { useMemo, type ReactNode } from "react";
import {
  Accordion,
  Badge,
  ColorInput,
  Group,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Slider,
  Stack,
  Switch,
  Text,
  Textarea,
  Title,
} from "@mantine/core";
import { SegmentedToggle } from "./SegmentedToggle";
import {
  SettingsFieldRow,
  SettingsInlineControls,
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
  type ReaderTapZoneMap,
} from "../store/reader";

const TAP_ACTION_LABEL_KEYS: Record<ReaderTapAction, TranslationKey> = {
  none: "readerSettings.tapAction.none",
  previous: "readerSettings.tapAction.previous",
  menu: "readerSettings.tapAction.menu",
  next: "readerSettings.tapAction.next",
};

const TAP_PRESET_LABEL_KEYS: Record<ReaderTapPresetId, TranslationKey> = {
  balanced: "readerSettings.tapPreset.balanced.label",
  "side-columns": "readerSettings.tapPreset.sideColumns.label",
  "vertical-scroll": "readerSettings.tapPreset.verticalScroll.label",
  "bottom-forward": "readerSettings.tapPreset.bottomForward.label",
};

const TAP_PRESET_DESCRIPTION_KEYS: Record<ReaderTapPresetId, TranslationKey> = {
  balanced: "readerSettings.tapPreset.balanced.description",
  "side-columns": "readerSettings.tapPreset.sideColumns.description",
  "vertical-scroll": "readerSettings.tapPreset.verticalScroll.description",
  "bottom-forward": "readerSettings.tapPreset.bottomForward.description",
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
    <Stack gap="lg">
      <ReaderSettingSection
        title={t("readerSettings.reading.title")}
        description={t("readerSettings.reading.description")}
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
                  setGeneral({ pageReader: true, twoPageReader: true });
                  break;
                case "paged":
                  setGeneral({ pageReader: true, twoPageReader: false });
                  break;
                default:
                  setGeneral({ pageReader: false, twoPageReader: false });
                  break;
              }
            }}
          />
        </SettingsFieldRow>
        <SettingsFieldRow label={t("readerSettings.keepScreenOn")}>
          <Switch
            checked={general.keepScreenOn}
            onChange={(event) =>
              setGeneral({ keepScreenOn: event.currentTarget.checked })
            }
          />
        </SettingsFieldRow>
      </ReaderSettingSection>

      <ReaderSettingSection
        title={t("readerSettings.text.title")}
        description={t("readerSettings.text.description")}
      >
        <SettingsFieldRow label={t("readerSettings.readerTheme")}>
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
        <SettingsFieldRow label={t("readerSettings.background")}>
          <ColorInput
            value={appearance.backgroundColor}
            onChange={(backgroundColor) =>
              setAppearance({ backgroundColor })
            }
          />
        </SettingsFieldRow>
        <SettingsFieldRow label={t("readerSettings.textColor")}>
          <ColorInput
            value={appearance.textColor}
            onChange={(textColor) => setAppearance({ textColor })}
          />
        </SettingsFieldRow>
        <SettingSlider
          label={t("readerSettings.textSize")}
          valueLabel={`${appearance.textSize}px`}
          min={12}
          max={36}
          step={1}
          value={appearance.textSize}
          onChange={(textSize) => setAppearance({ textSize })}
        />
        <SettingSlider
          label={t("readerSettings.lineHeight")}
          valueLabel={appearance.lineHeight.toFixed(2)}
          min={1}
          max={2.6}
          step={0.05}
          value={appearance.lineHeight}
          onChange={(lineHeight) => setAppearance({ lineHeight })}
        />
        <SettingSlider
          label={t("readerSettings.padding")}
          valueLabel={`${appearance.padding}px`}
          min={0}
          max={64}
          step={1}
          value={appearance.padding}
          onChange={(padding) => setAppearance({ padding })}
        />
        <SettingsFieldRow label={t("readerSettings.font")}>
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
        <SettingsFieldRow label={t("readerSettings.alignment")}>
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
        <SettingsFieldRow>
          <SettingsInlineControls>
            <TextButton variant="default" onClick={handleSaveCustomTheme}>
              {t("readerSettings.saveCustomTheme")}
            </TextButton>
            <TextButton variant="default" onClick={resetReaderSettings}>
              {t("readerSettings.reset")}
            </TextButton>
          </SettingsInlineControls>
        </SettingsFieldRow>
      </ReaderSettingSection>

      <ReaderSettingSection
        title={t("readerSettings.controls.title")}
        description={t("readerSettings.controls.description")}
      >
        <SettingsFieldRow label={t("readerSettings.swipeGestures")}>
          <Switch
            checked={general.swipeGestures}
            onChange={(event) =>
              setGeneral({ swipeGestures: event.currentTarget.checked })
            }
          />
        </SettingsFieldRow>
        <SettingsFieldRow label={t("readerSettings.tapControls")}>
          <Switch
            checked={general.tapToScroll}
            onChange={(event) =>
              setGeneral({ tapToScroll: event.currentTarget.checked })
            }
          />
        </SettingsFieldRow>
        {general.tapToScroll ? (
          <SettingsFieldRow layout="stacked">
            <SettingsWideField>
              <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
                {READER_TAP_PRESETS.map((preset) => (
                  <TapZonePresetCard
                    key={preset.id}
                    preset={preset}
                    selected={preset.id === general.tapZonePresetId}
                    onApply={applyTapZonePreset}
                  />
                ))}
              </SimpleGrid>
            </SettingsWideField>
          </SettingsFieldRow>
        ) : null}
      </ReaderSettingSection>

      <ReaderSettingSection
        title={t("readerSettings.indicators.title")}
        description={t("readerSettings.indicators.description")}
      >
        <SettingsFieldRow label={t("readerSettings.seekbar")}>
          <Switch
            checked={general.showSeekbar}
            onChange={(event) =>
              setGeneral({ showSeekbar: event.currentTarget.checked })
            }
          />
        </SettingsFieldRow>
        {general.showSeekbar ? (
          <SettingsFieldRow label={t("readerSettings.verticalSeekbar")}>
            <Switch
              checked={general.verticalSeekbar}
              onChange={(event) =>
                setGeneral({ verticalSeekbar: event.currentTarget.checked })
              }
            />
          </SettingsFieldRow>
        ) : null}
        <SettingsFieldRow label={t("readerSettings.scrollPercentage")}>
          <Switch
            checked={general.showScrollPercentage}
            onChange={(event) =>
              setGeneral({
                showScrollPercentage: event.currentTarget.checked,
              })
            }
          />
        </SettingsFieldRow>
        <SettingsFieldRow label={t("readerSettings.batteryTimeFooter")}>
          <Switch
            checked={general.showBatteryAndTime}
            onChange={(event) =>
              setGeneral({
                showBatteryAndTime: event.currentTarget.checked,
              })
            }
          />
        </SettingsFieldRow>
      </ReaderSettingSection>

      <ReaderSettingSection
        title={t("readerSettings.automation.title")}
        description={t("readerSettings.automation.description")}
      >
        <SettingsFieldRow label={t("readerSettings.autoScroll")}>
          <Switch
            checked={general.autoScroll}
            onChange={(event) =>
              setGeneral({ autoScroll: event.currentTarget.checked })
            }
          />
        </SettingsFieldRow>
        {general.autoScroll ? (
          <>
            <SettingsFieldRow label={t("readerSettings.autoScrollInterval")}>
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
            <SettingsFieldRow label={t("readerSettings.autoScrollOffset")}>
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
      </ReaderSettingSection>

      <Accordion variant="contained">
        <Accordion.Item value="advanced">
          <Accordion.Control>{t("readerSettings.advanced")}</Accordion.Control>
          <Accordion.Panel>
            <Stack gap="md">
              <SettingsFieldRow label={t("readerSettings.bionicReading")}>
                <Switch
                  checked={general.bionicReading}
                  onChange={(event) =>
                    setGeneral({ bionicReading: event.currentTarget.checked })
                  }
                />
              </SettingsFieldRow>
              <SettingsFieldRow
                label={t("readerSettings.removeExtraParagraphSpacing")}
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
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Stack>
  );
}

function ReaderSettingSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Stack gap="sm">
      <Stack className="lnr-reader-settings-section-heading" gap={2}>
        <Title order={4}>{title}</Title>
        <Text size="sm" c="dimmed">
          {description}
        </Text>
      </Stack>
      {children}
    </Stack>
  );
}

function SettingSlider({
  label,
  valueLabel,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  valueLabel: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <SettingsFieldRow label={label}>
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
  preset,
  selected,
  onApply,
}: {
  preset: ReaderTapPreset;
  selected: boolean;
  onApply: (presetId: ReaderTapPresetId) => void;
}) {
  const { t } = useTranslation();

  return (
    <Paper
      withBorder
      p="md"
      radius="md"
      style={{
        borderColor: selected
          ? "var(--mantine-color-blue-5)"
          : "var(--mantine-color-default-border)",
      }}
    >
      <Stack gap="sm">
        <Group justify="space-between" align="center">
          <Text fw={700}>{t(TAP_PRESET_LABEL_KEYS[preset.id])}</Text>
          {selected ? (
            <Badge variant="light">{t("common.selected")}</Badge>
          ) : null}
        </Group>
        <Text size="sm" c="dimmed">
          {t(TAP_PRESET_DESCRIPTION_KEYS[preset.id])}
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          <TapZonePreview
            title={t("readerSettings.orientation.portrait")}
            zones={preset.portrait}
          />
          <TapZonePreview
            title={t("readerSettings.orientation.landscape")}
            zones={preset.landscape}
          />
        </SimpleGrid>
        {selected ? null : (
          <TextButton variant="default" onClick={() => onApply(preset.id)}>
            {t("common.usePreset")}
          </TextButton>
        )}
      </Stack>
    </Paper>
  );
}

function TapZonePreview({
  title,
  zones,
}: {
  title: string;
  zones: ReaderTapZoneMap;
}) {
  const { t } = useTranslation();

  return (
    <Stack gap={6}>
      <Text size="xs" fw={600} c="dimmed">
        {title}
      </Text>
      <SimpleGrid cols={3} spacing={4}>
        {READER_TAP_ZONES.map((zone) => {
          const action = zones[zone];
          return (
            <Text
              key={zone}
              size="xs"
              ta="center"
              fw={600}
              style={{
                border: "1px solid var(--mantine-color-default-border)",
                borderRadius: 4,
                padding: "8px 4px",
                background: getTapActionBackground(action),
                color: getTapActionColor(action),
              }}
            >
              {t(TAP_ACTION_LABEL_KEYS[action])}
            </Text>
          );
        })}
      </SimpleGrid>
    </Stack>
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
