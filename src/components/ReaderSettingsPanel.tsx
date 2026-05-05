import { useMemo, type ReactNode } from "react";
import {
  Accordion,
  Badge,
  Button,
  ColorInput,
  Divider,
  Group,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Slider,
  Stack,
  Switch,
  Text,
  Textarea,
  Title,
} from "@mantine/core";
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

const TAP_ACTION_LABELS: Record<ReaderTapAction, string> = {
  none: "Off",
  previous: "Prev",
  menu: "Menu",
  next: "Next",
};

export function ReaderSettingsPanel() {
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

  function handleSaveCustomTheme(): void {
    const id = `custom-${Date.now()}`;
    saveCustomTheme({
      id,
      label: `Custom ${appearance.customThemes.length + 1}`,
      backgroundColor: appearance.backgroundColor,
      textColor: appearance.textColor,
    });
    setAppearance({ themeId: id });
  }

  return (
    <Stack gap="lg">
      <ReaderSettingSection
        title="Reading"
        description="Choose the reader mode and screen behavior."
      >
        <Stack gap={4}>
          <Text size="sm">Reading mode</Text>
          <SegmentedControl
            data={[
              { value: "scroll", label: "Scroll" },
              { value: "paged", label: "Paged" },
            ]}
            value={general.pageReader ? "paged" : "scroll"}
            onChange={(value) => setGeneral({ pageReader: value === "paged" })}
          />
        </Stack>
        <Group>
          <Switch
            label="Fullscreen reader"
            checked={general.fullScreen}
            onChange={(event) =>
              setGeneral({ fullScreen: event.currentTarget.checked })
            }
          />
          <Switch
            label="Keep screen on"
            checked={general.keepScreenOn}
            onChange={(event) =>
              setGeneral({ keepScreenOn: event.currentTarget.checked })
            }
          />
        </Group>
      </ReaderSettingSection>

      <Divider />

      <ReaderSettingSection
        title="Text"
        description="Control the reader theme, typography, and spacing."
      >
        <Select
          label="Reader theme"
          data={readerThemes.map((theme) => ({
            value: theme.id,
            label: theme.label,
          }))}
          value={appearance.themeId}
          onChange={(themeId) => {
            const nextTheme = readerThemes.find(
              (theme) => theme.id === themeId,
            );
            if (nextTheme) applyTheme(nextTheme);
          }}
        />
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          <ColorInput
            label="Background"
            value={appearance.backgroundColor}
            onChange={(backgroundColor) =>
              setAppearance({ backgroundColor })
            }
          />
          <ColorInput
            label="Text"
            value={appearance.textColor}
            onChange={(textColor) => setAppearance({ textColor })}
          />
        </SimpleGrid>
        <SettingSlider
          label="Text size"
          valueLabel={`${appearance.textSize}px`}
          min={12}
          max={36}
          step={1}
          value={appearance.textSize}
          onChange={(textSize) => setAppearance({ textSize })}
        />
        <SettingSlider
          label="Line height"
          valueLabel={appearance.lineHeight.toFixed(2)}
          min={1}
          max={2.6}
          step={0.05}
          value={appearance.lineHeight}
          onChange={(lineHeight) => setAppearance({ lineHeight })}
        />
        <SettingSlider
          label="Padding"
          valueLabel={`${appearance.padding}px`}
          min={0}
          max={64}
          step={1}
          value={appearance.padding}
          onChange={(padding) => setAppearance({ padding })}
        />
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          <Select
            label="Font"
            data={READER_FONT_OPTIONS}
            value={appearance.fontFamily}
            onChange={(fontFamily) =>
              setAppearance({ fontFamily: fontFamily ?? "" })
            }
          />
          <Stack gap={4}>
            <Text size="sm">Alignment</Text>
            <SegmentedControl
              value={appearance.textAlign}
              onChange={(textAlign) =>
                setAppearance({
                  textAlign: textAlign as typeof appearance.textAlign,
                })
              }
              data={[
                { value: "left", label: "Left" },
                { value: "justify", label: "Justify" },
                { value: "center", label: "Center" },
                { value: "right", label: "Right" },
              ]}
            />
          </Stack>
        </SimpleGrid>
        <Group>
          <Button variant="default" onClick={handleSaveCustomTheme}>
            Save custom theme
          </Button>
          <Button variant="default" onClick={resetReaderSettings}>
            Reset reader settings
          </Button>
        </Group>
      </ReaderSettingSection>

      <Divider />

      <ReaderSettingSection
        title="Controls"
        description="Choose gesture behavior and the tap control preset."
      >
        <Group>
          <Switch
            label="Swipe gestures"
            checked={general.swipeGestures}
            onChange={(event) =>
              setGeneral({ swipeGestures: event.currentTarget.checked })
            }
          />
          <Switch
            label="Tap controls"
            checked={general.tapToScroll}
            onChange={(event) =>
              setGeneral({ tapToScroll: event.currentTarget.checked })
            }
          />
        </Group>
        {general.tapToScroll ? (
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
        ) : null}
      </ReaderSettingSection>

      <Divider />

      <ReaderSettingSection
        title="Indicators"
        description="Control reader progress indicators and footer details."
      >
        <Group>
          <Switch
            label="Seekbar"
            checked={general.showSeekbar}
            onChange={(event) =>
              setGeneral({ showSeekbar: event.currentTarget.checked })
            }
          />
          {general.showSeekbar ? (
            <Switch
              label="Vertical seekbar"
              checked={general.verticalSeekbar}
              onChange={(event) =>
                setGeneral({ verticalSeekbar: event.currentTarget.checked })
              }
            />
          ) : null}
          <Switch
            label="Scroll percentage"
            checked={general.showScrollPercentage}
            onChange={(event) =>
              setGeneral({
                showScrollPercentage: event.currentTarget.checked,
              })
            }
          />
          <Switch
            label="Battery and time footer"
            checked={general.showBatteryAndTime}
            onChange={(event) =>
              setGeneral({
                showBatteryAndTime: event.currentTarget.checked,
              })
            }
          />
        </Group>
      </ReaderSettingSection>

      <Divider />

      <ReaderSettingSection
        title="Automation"
        description="Let the reader move automatically while the chapter is open."
      >
        <Switch
          label="Auto-scroll"
          checked={general.autoScroll}
          onChange={(event) =>
            setGeneral({ autoScroll: event.currentTarget.checked })
          }
        />
        {general.autoScroll ? (
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
            <NumberInput
              label="Auto-scroll interval"
              value={general.autoScrollInterval}
              min={16}
              max={500}
              onChange={(value) => {
                if (typeof value === "number") {
                  setGeneral({ autoScrollInterval: value });
                }
              }}
            />
            <NumberInput
              label="Auto-scroll offset"
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
          </SimpleGrid>
        ) : null}
      </ReaderSettingSection>

      <Accordion variant="contained">
        <Accordion.Item value="advanced">
          <Accordion.Control>Advanced</Accordion.Control>
          <Accordion.Panel>
            <Stack gap="md">
              <Group>
                <Switch
                  label="Bionic reading"
                  checked={general.bionicReading}
                  onChange={(event) =>
                    setGeneral({ bionicReading: event.currentTarget.checked })
                  }
                />
                <Switch
                  label="Remove extra paragraph spacing"
                  checked={general.removeExtraParagraphSpacing}
                  onChange={(event) =>
                    setGeneral({
                      removeExtraParagraphSpacing:
                        event.currentTarget.checked,
                    })
                  }
                />
              </Group>
              <Textarea
                label="Custom CSS"
                value={appearance.customCss}
                autosize
                minRows={5}
                onChange={(event) =>
                  setAppearance({ customCss: event.currentTarget.value })
                }
              />
              <Textarea
                label="Custom JS"
                value={appearance.customJs}
                autosize
                minRows={5}
                onChange={(event) =>
                  setAppearance({ customJs: event.currentTarget.value })
                }
              />
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
      <Stack gap={2}>
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
    <Stack gap={4}>
      <Group justify="space-between">
        <Text size="sm">{label}</Text>
        <Text size="sm" c="dimmed">
          {valueLabel}
        </Text>
      </Group>
      <Slider
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={onChange}
      />
    </Stack>
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
          <Text fw={700}>{preset.label}</Text>
          {selected ? <Badge variant="light">Selected</Badge> : null}
        </Group>
        <Text size="sm" c="dimmed">
          {preset.description}
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          <TapZonePreview title="Portrait" zones={preset.portrait} />
          <TapZonePreview title="Landscape" zones={preset.landscape} />
        </SimpleGrid>
        <Button
          variant={selected ? "light" : "default"}
          disabled={selected}
          onClick={() => onApply(preset.id)}
        >
          {selected ? "Selected" : "Use preset"}
        </Button>
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
              {TAP_ACTION_LABELS[action]}
            </Text>
          );
        })}
      </SimpleGrid>
    </Stack>
  );
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
