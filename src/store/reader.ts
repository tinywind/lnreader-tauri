import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ReaderPresetTheme = "paper" | "sepia" | "sage" | "dark" | "amoled";
export type ReaderTextAlign = "left" | "justify" | "center" | "right";
export type ReaderTapAction = "none" | "previous" | "menu" | "next";
export type ReaderTapPresetId =
  | "balanced"
  | "side-columns"
  | "vertical-scroll"
  | "bottom-forward";
export type ReaderTapZone =
  | "topLeft"
  | "topCenter"
  | "topRight"
  | "middleLeft"
  | "middleCenter"
  | "middleRight"
  | "bottomLeft"
  | "bottomCenter"
  | "bottomRight";
export type ReaderTapZoneMap = Record<ReaderTapZone, ReaderTapAction>;

export interface ReaderTapPreset {
  id: ReaderTapPresetId;
  label: string;
  description: string;
  portrait: ReaderTapZoneMap;
  landscape: ReaderTapZoneMap;
}

export interface ReaderThemeDefinition {
  id: string;
  label: string;
  backgroundColor: string;
  textColor: string;
}

export interface ReaderGeneralSettings {
  keepScreenOn: boolean;
  pageReader: boolean;
  twoPageReader: boolean;
  swipeGestures: boolean;
  tapToScroll: boolean;
  showSeekbar: boolean;
  verticalSeekbar: boolean;
  showScrollPercentage: boolean;
  showBatteryAndTime: boolean;
  autoScroll: boolean;
  autoScrollInterval: number;
  autoScrollOffset: number;
  bionicReading: boolean;
  removeExtraParagraphSpacing: boolean;
  tapZonePresetId: ReaderTapPresetId;
  portraitTapZones: ReaderTapZoneMap;
  landscapeTapZones: ReaderTapZoneMap;
}

export interface ReaderAppearanceSettings {
  themeId: string;
  backgroundColor: string;
  textColor: string;
  textSize: number;
  textAlign: ReaderTextAlign;
  padding: number;
  fontFamily: string;
  lineHeight: number;
  customCss: string;
  customJs: string;
  customThemes: ReaderThemeDefinition[];
}

interface ReaderState {
  general: ReaderGeneralSettings;
  appearance: ReaderAppearanceSettings;
  lastReadChapterByNovel: Record<number, number>;
  novelPageIndexByNovel: Record<number, number>;
  setGeneral: (settings: Partial<ReaderGeneralSettings>) => void;
  setAppearance: (settings: Partial<ReaderAppearanceSettings>) => void;
  applyTheme: (theme: ReaderThemeDefinition) => void;
  saveCustomTheme: (theme: ReaderThemeDefinition) => void;
  deleteCustomTheme: (themeId: string) => void;
  applyTapZonePreset: (presetId: ReaderTapPresetId) => void;
  setLastReadChapter: (novelId: number, chapterId: number) => void;
  setNovelPageIndex: (novelId: number, pageIndex: number) => void;
  resetReaderSettings: () => void;
}

export const READER_PRESET_THEMES: ReaderThemeDefinition[] = [
  {
    id: "paper",
    label: "Paper",
    backgroundColor: "#f5f5fa",
    textColor: "#111111",
  },
  {
    id: "sepia",
    label: "Sepia",
    backgroundColor: "#F7DFC6",
    textColor: "#593100",
  },
  {
    id: "sage",
    label: "Sage",
    backgroundColor: "#dce5e2",
    textColor: "#000000",
  },
  {
    id: "dark",
    label: "Dark",
    backgroundColor: "#292832",
    textColor: "#CCCCCC",
  },
  {
    id: "amoled",
    label: "AMOLED",
    backgroundColor: "#000000",
    textColor: "#FFFFFF",
  },
];

export const READER_FONT_OPTIONS = [
  { value: "", label: "Original" },
  { value: "Lora, Georgia, serif", label: "Lora" },
  { value: "Nunito, Arial, sans-serif", label: "Nunito" },
  { value: "\"Noto Sans\", Arial, sans-serif", label: "Noto Sans" },
  { value: "\"Open Sans\", Arial, sans-serif", label: "Open Sans" },
  { value: "\"Arbutus Slab\", Georgia, serif", label: "Arbutus Slab" },
  { value: "Domine, Georgia, serif", label: "Domine" },
  { value: "Lato, Arial, sans-serif", label: "Lato" },
  { value: "\"PT Serif\", Georgia, serif", label: "PT Serif" },
  { value: "OpenDyslexic, Arial, sans-serif", label: "OpenDyslexic" },
];

const DEFAULT_READER_THEME = READER_PRESET_THEMES[3]!;

export const READER_TAP_ZONES: ReaderTapZone[] = [
  "topLeft",
  "topCenter",
  "topRight",
  "middleLeft",
  "middleCenter",
  "middleRight",
  "bottomLeft",
  "bottomCenter",
  "bottomRight",
];

export const READER_TAP_PRESETS: ReaderTapPreset[] = [
  {
    id: "balanced",
    label: "Balanced",
    description:
      "Top and left go back, bottom and right go forward, center opens the menu.",
    portrait: {
      topLeft: "previous",
      topCenter: "previous",
      topRight: "previous",
      middleLeft: "previous",
      middleCenter: "menu",
      middleRight: "next",
      bottomLeft: "next",
      bottomCenter: "next",
      bottomRight: "next",
    },
    landscape: {
      topLeft: "previous",
      topCenter: "menu",
      topRight: "next",
      middleLeft: "previous",
      middleCenter: "menu",
      middleRight: "next",
      bottomLeft: "previous",
      bottomCenter: "menu",
      bottomRight: "next",
    },
  },
  {
    id: "side-columns",
    label: "Side columns",
    description:
      "Left column goes back and right column goes forward. The middle column opens the menu.",
    portrait: {
      topLeft: "previous",
      topCenter: "menu",
      topRight: "next",
      middleLeft: "previous",
      middleCenter: "menu",
      middleRight: "next",
      bottomLeft: "previous",
      bottomCenter: "menu",
      bottomRight: "next",
    },
    landscape: {
      topLeft: "previous",
      topCenter: "menu",
      topRight: "next",
      middleLeft: "previous",
      middleCenter: "menu",
      middleRight: "next",
      bottomLeft: "previous",
      bottomCenter: "menu",
      bottomRight: "next",
    },
  },
  {
    id: "vertical-scroll",
    label: "Vertical scroll",
    description:
      "Top goes back, bottom goes forward, and the middle row opens the menu.",
    portrait: {
      topLeft: "previous",
      topCenter: "previous",
      topRight: "previous",
      middleLeft: "menu",
      middleCenter: "menu",
      middleRight: "menu",
      bottomLeft: "next",
      bottomCenter: "next",
      bottomRight: "next",
    },
    landscape: {
      topLeft: "previous",
      topCenter: "previous",
      topRight: "previous",
      middleLeft: "menu",
      middleCenter: "menu",
      middleRight: "menu",
      bottomLeft: "next",
      bottomCenter: "next",
      bottomRight: "next",
    },
  },
  {
    id: "bottom-forward",
    label: "Bottom forward",
    description:
      "Large lower area advances, upper area goes back, center still opens the menu.",
    portrait: {
      topLeft: "previous",
      topCenter: "previous",
      topRight: "previous",
      middleLeft: "previous",
      middleCenter: "menu",
      middleRight: "next",
      bottomLeft: "next",
      bottomCenter: "next",
      bottomRight: "next",
    },
    landscape: {
      topLeft: "previous",
      topCenter: "menu",
      topRight: "next",
      middleLeft: "previous",
      middleCenter: "menu",
      middleRight: "next",
      bottomLeft: "next",
      bottomCenter: "next",
      bottomRight: "next",
    },
  },
];

const DEFAULT_TAP_ZONE_PRESET = READER_TAP_PRESETS[0]!;

export const PORTRAIT_TAP_ZONE_DEFAULTS = DEFAULT_TAP_ZONE_PRESET.portrait;
export const LANDSCAPE_TAP_ZONE_DEFAULTS = DEFAULT_TAP_ZONE_PRESET.landscape;

export const READER_GENERAL_DEFAULTS: ReaderGeneralSettings = {
  keepScreenOn: false,
  pageReader: false,
  twoPageReader: false,
  swipeGestures: true,
  tapToScroll: true,
  showSeekbar: true,
  verticalSeekbar: false,
  showScrollPercentage: true,
  showBatteryAndTime: true,
  autoScroll: false,
  autoScrollInterval: 80,
  autoScrollOffset: 1,
  bionicReading: false,
  removeExtraParagraphSpacing: false,
  tapZonePresetId: DEFAULT_TAP_ZONE_PRESET.id,
  portraitTapZones: PORTRAIT_TAP_ZONE_DEFAULTS,
  landscapeTapZones: LANDSCAPE_TAP_ZONE_DEFAULTS,
};

export const READER_APPEARANCE_DEFAULTS: ReaderAppearanceSettings = {
  themeId: DEFAULT_READER_THEME.id,
  backgroundColor: DEFAULT_READER_THEME.backgroundColor,
  textColor: DEFAULT_READER_THEME.textColor,
  textSize: 16,
  textAlign: "left",
  padding: 16,
  fontFamily: "",
  lineHeight: 1.5,
  customCss: "",
  customJs: "",
  customThemes: [],
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function normalizeGeneral(
  settings: Partial<ReaderGeneralSettings>,
): Partial<ReaderGeneralSettings> {
  const normalized: Partial<ReaderGeneralSettings> = {
    ...settings,
    ...(settings.autoScrollInterval !== undefined
      ? {
          autoScrollInterval: Math.round(
            clamp(settings.autoScrollInterval, 16, 500),
          ),
        }
      : {}),
    ...(settings.autoScrollOffset !== undefined
      ? { autoScrollOffset: clamp(settings.autoScrollOffset, 0.25, 12) }
      : {}),
    ...(settings.tapZonePresetId !== undefined
      ? { tapZonePresetId: normalizeTapZonePresetId(settings.tapZonePresetId) }
      : {}),
    ...(settings.portraitTapZones !== undefined
      ? {
          portraitTapZones: normalizeTapZones(
            settings.portraitTapZones,
            PORTRAIT_TAP_ZONE_DEFAULTS,
          ),
        }
      : {}),
    ...(settings.landscapeTapZones !== undefined
      ? {
          landscapeTapZones: normalizeTapZones(
            settings.landscapeTapZones,
            LANDSCAPE_TAP_ZONE_DEFAULTS,
          ),
        }
      : {}),
  };

  if (settings.twoPageReader === true) {
    normalized.pageReader = true;
  }
  if (settings.pageReader === false) {
    normalized.twoPageReader = false;
  }

  return normalized;
}

function normalizeTapZonePresetId(value: unknown): ReaderTapPresetId {
  return READER_TAP_PRESETS.some((preset) => preset.id === value)
    ? (value as ReaderTapPresetId)
    : DEFAULT_TAP_ZONE_PRESET.id;
}

function getTapZonePreset(presetId: ReaderTapPresetId): ReaderTapPreset {
  return (
    READER_TAP_PRESETS.find((preset) => preset.id === presetId) ??
    DEFAULT_TAP_ZONE_PRESET
  );
}

function isTapAction(value: unknown): value is ReaderTapAction {
  return (
    value === "none" ||
    value === "previous" ||
    value === "menu" ||
    value === "next"
  );
}

function normalizeTapZones(
  zones: Partial<ReaderTapZoneMap>,
  fallback: ReaderTapZoneMap,
): ReaderTapZoneMap {
  const next = { ...fallback };
  for (const zone of READER_TAP_ZONES) {
    const action = zones[zone];
    if (isTapAction(action)) {
      next[zone] = action;
    }
  }
  next.middleCenter = "menu";
  return next;
}

function normalizeAppearance(
  settings: Partial<ReaderAppearanceSettings>,
): Partial<ReaderAppearanceSettings> {
  return {
    ...settings,
    ...(settings.textSize !== undefined
      ? { textSize: Math.round(clamp(settings.textSize, 12, 36)) }
      : {}),
    ...(settings.padding !== undefined
      ? { padding: Math.round(clamp(settings.padding, 0, 64)) }
      : {}),
    ...(settings.lineHeight !== undefined
      ? { lineHeight: clamp(settings.lineHeight, 1, 2.6) }
      : {}),
  };
}

export const useReaderStore = create<ReaderState>()(
  persist(
    (set) => ({
      general: READER_GENERAL_DEFAULTS,
      appearance: READER_APPEARANCE_DEFAULTS,
      lastReadChapterByNovel: {},
      novelPageIndexByNovel: {},
      setGeneral: (settings) =>
        set((state) => ({
          general: {
            ...state.general,
            ...normalizeGeneral(settings),
          },
        })),
      setAppearance: (settings) =>
        set((state) => ({
          appearance: {
            ...state.appearance,
            ...normalizeAppearance(settings),
          },
        })),
      applyTheme: (theme) =>
        set((state) => ({
          appearance: {
            ...state.appearance,
            themeId: theme.id,
            backgroundColor: theme.backgroundColor,
            textColor: theme.textColor,
          },
        })),
      saveCustomTheme: (theme) =>
        set((state) => {
          const customThemes = state.appearance.customThemes.filter(
            (entry) => entry.id !== theme.id,
          );
          customThemes.push(theme);
          return {
            appearance: {
              ...state.appearance,
              customThemes,
            },
          };
        }),
      deleteCustomTheme: (themeId) =>
        set((state) => ({
          appearance: {
            ...state.appearance,
            customThemes: state.appearance.customThemes.filter(
              (theme) => theme.id !== themeId,
            ),
          },
        })),
      applyTapZonePreset: (presetId) =>
        set((state) => {
          const preset = getTapZonePreset(presetId);
          return {
            general: {
              ...state.general,
              tapZonePresetId: preset.id,
              portraitTapZones: normalizeTapZones(
                preset.portrait,
                PORTRAIT_TAP_ZONE_DEFAULTS,
              ),
              landscapeTapZones: normalizeTapZones(
                preset.landscape,
                LANDSCAPE_TAP_ZONE_DEFAULTS,
              ),
            },
          };
        }),
      setLastReadChapter: (novelId, chapterId) =>
        set((state) => ({
          lastReadChapterByNovel: {
            ...state.lastReadChapterByNovel,
            [novelId]: chapterId,
          },
        })),
      setNovelPageIndex: (novelId, pageIndex) =>
        set((state) => ({
          novelPageIndexByNovel: {
            ...state.novelPageIndexByNovel,
            [novelId]: Math.max(1, Math.round(pageIndex)),
          },
        })),
      resetReaderSettings: () =>
        set({
          general: READER_GENERAL_DEFAULTS,
          appearance: READER_APPEARANCE_DEFAULTS,
        }),
    }),
    {
      name: "reader-settings",
      merge: (persistedState, currentState) => {
        if (persistedState === null || typeof persistedState !== "object") {
          return currentState;
        }
        const persisted = persistedState as Partial<ReaderState>;
        const tapZonePresetId = normalizeTapZonePresetId(
          persisted.general?.tapZonePresetId,
        );
        const tapZonePreset = getTapZonePreset(tapZonePresetId);
        const persistedGeneral = { ...(persisted.general ?? {}) } as Partial<
          ReaderGeneralSettings
        > & { fullScreen?: unknown };
        delete persistedGeneral.fullScreen;
        const general = {
          ...READER_GENERAL_DEFAULTS,
          ...persistedGeneral,
          tapZonePresetId,
          portraitTapZones: normalizeTapZones(
            persistedGeneral.portraitTapZones ?? tapZonePreset.portrait,
            tapZonePreset.portrait,
          ),
          landscapeTapZones: normalizeTapZones(
            persistedGeneral.landscapeTapZones ?? tapZonePreset.landscape,
            tapZonePreset.landscape,
          ),
        };
        if (!general.pageReader) {
          general.twoPageReader = false;
        }

        return {
          ...currentState,
          ...persisted,
          general,
          appearance: {
            ...READER_APPEARANCE_DEFAULTS,
            ...persisted.appearance,
          },
        };
      },
      partialize: (state) => ({
        general: state.general,
        appearance: state.appearance,
        lastReadChapterByNovel: state.lastReadChapterByNovel,
        novelPageIndexByNovel: state.novelPageIndexByNovel,
      }),
    },
  ),
);
