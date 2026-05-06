import { beforeEach, describe, expect, it } from "vitest";
import {
  READER_APPEARANCE_DEFAULTS,
  READER_GENERAL_DEFAULTS,
  READER_PRESET_THEMES,
  READER_TAP_PRESETS,
  useReaderStore,
} from "./reader";

beforeEach(() => {
  useReaderStore.getState().resetReaderSettings();
});

describe("useReaderStore", () => {
  it("starts at defaults", () => {
    const state = useReaderStore.getState();
    expect(state.general).toEqual(READER_GENERAL_DEFAULTS);
    expect(state.appearance).toEqual(READER_APPEARANCE_DEFAULTS);
  });

  it("setGeneral merges pageReader without dropping other fields", () => {
    useReaderStore
      .getState()
      .setGeneral({ pageReader: true, autoScroll: true });
    expect(useReaderStore.getState().general.pageReader).toBe(true);
    expect(useReaderStore.getState().general.autoScroll).toBe(true);
    expect(useReaderStore.getState().general.swipeGestures).toBe(
      READER_GENERAL_DEFAULTS.swipeGestures,
    );
  });

  it("setGeneral keeps two-page reader tied to paged reading", () => {
    useReaderStore.getState().setGeneral({ twoPageReader: true });
    expect(useReaderStore.getState().general.pageReader).toBe(true);
    expect(useReaderStore.getState().general.twoPageReader).toBe(true);

    useReaderStore.getState().setGeneral({ pageReader: false });
    expect(useReaderStore.getState().general.pageReader).toBe(false);
    expect(useReaderStore.getState().general.twoPageReader).toBe(false);
  });

  it("setGeneral clamps autoScrollInterval to [16, 500] and rounds", () => {
    useReaderStore.getState().setGeneral({ autoScrollInterval: 0 });
    expect(useReaderStore.getState().general.autoScrollInterval).toBe(16);
    useReaderStore.getState().setGeneral({ autoScrollInterval: 9999 });
    expect(useReaderStore.getState().general.autoScrollInterval).toBe(500);
    useReaderStore.getState().setGeneral({ autoScrollInterval: 80.4 });
    expect(useReaderStore.getState().general.autoScrollInterval).toBe(80);
  });

  it("applyTapZonePreset writes preset maps and keeps the center action as menu", () => {
    const preset = READER_TAP_PRESETS.find(
      (candidate) => candidate.id === "vertical-scroll",
    )!;
    useReaderStore.getState().applyTapZonePreset(preset.id);
    const general = useReaderStore.getState().general;

    expect(general.tapZonePresetId).toBe(preset.id);
    expect(general.portraitTapZones.topLeft).toBe(preset.portrait.topLeft);
    expect(general.portraitTapZones.middleCenter).toBe("menu");
    expect(general.landscapeTapZones.bottomRight).toBe(
      preset.landscape.bottomRight,
    );
    expect(general.landscapeTapZones.middleCenter).toBe("menu");
  });

  it("setAppearance clamps textSize to [12, 36] and rounds", () => {
    useReaderStore.getState().setAppearance({ textSize: 0 });
    expect(useReaderStore.getState().appearance.textSize).toBe(12);
    useReaderStore.getState().setAppearance({ textSize: 999 });
    expect(useReaderStore.getState().appearance.textSize).toBe(36);
    useReaderStore.getState().setAppearance({ textSize: 20.6 });
    expect(useReaderStore.getState().appearance.textSize).toBe(21);
  });

  it("setAppearance clamps lineHeight to [1.0, 2.6]", () => {
    useReaderStore.getState().setAppearance({ lineHeight: 0.5 });
    expect(useReaderStore.getState().appearance.lineHeight).toBe(1.0);
    useReaderStore.getState().setAppearance({ lineHeight: 5 });
    expect(useReaderStore.getState().appearance.lineHeight).toBe(2.6);
  });

  it("applyTheme writes themeId + backgroundColor + textColor", () => {
    const dark = READER_PRESET_THEMES.find((theme) => theme.id === "dark")!;
    useReaderStore.getState().applyTheme(dark);
    const appearance = useReaderStore.getState().appearance;
    expect(appearance.themeId).toBe(dark.id);
    expect(appearance.backgroundColor).toBe(dark.backgroundColor);
    expect(appearance.textColor).toBe(dark.textColor);
  });

  it("saveCustomTheme adds the theme and replaces a previous entry by id", () => {
    useReaderStore.getState().saveCustomTheme({
      id: "myth",
      label: "My Theme",
      backgroundColor: "#101010",
      textColor: "#fafafa",
    });
    expect(useReaderStore.getState().appearance.customThemes).toHaveLength(1);
    useReaderStore.getState().saveCustomTheme({
      id: "myth",
      label: "My Theme v2",
      backgroundColor: "#202020",
      textColor: "#eeeeee",
    });
    const stored = useReaderStore.getState().appearance.customThemes;
    expect(stored).toHaveLength(1);
    expect(stored[0]?.label).toBe("My Theme v2");
  });

  it("deleteCustomTheme removes only the matching id", () => {
    useReaderStore.getState().saveCustomTheme({
      id: "a",
      label: "A",
      backgroundColor: "#000",
      textColor: "#fff",
    });
    useReaderStore.getState().saveCustomTheme({
      id: "b",
      label: "B",
      backgroundColor: "#111",
      textColor: "#fff",
    });
    useReaderStore.getState().deleteCustomTheme("a");
    const remaining = useReaderStore.getState().appearance.customThemes;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe("b");
  });

  it("setLastReadChapter records the chapter id under the novel id", () => {
    useReaderStore.getState().setLastReadChapter(7, 42);
    expect(useReaderStore.getState().lastReadChapterByNovel[7]).toBe(42);
  });

  it("setNovelPageIndex floors negatives to 1 and rounds fractional input", () => {
    useReaderStore.getState().setNovelPageIndex(7, 0);
    expect(useReaderStore.getState().novelPageIndexByNovel[7]).toBe(1);
    useReaderStore.getState().setNovelPageIndex(7, 3.6);
    expect(useReaderStore.getState().novelPageIndexByNovel[7]).toBe(4);
  });

  it("resetReaderSettings returns general + appearance to defaults", () => {
    useReaderStore
      .getState()
      .setGeneral({ pageReader: true, twoPageReader: true });
    useReaderStore.getState().setAppearance({ textSize: 30 });
    useReaderStore.getState().resetReaderSettings();
    const state = useReaderStore.getState();
    expect(state.general).toEqual(READER_GENERAL_DEFAULTS);
    expect(state.appearance).toEqual(READER_APPEARANCE_DEFAULTS);
  });
});
