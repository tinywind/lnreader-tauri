import { beforeEach, describe, expect, it } from "vitest";
import { READER_DEFAULTS, useReaderStore } from "./reader";

beforeEach(() => {
  useReaderStore.getState().reset();
});

describe("useReaderStore", () => {
  it("starts at defaults", () => {
    const state = useReaderStore.getState();
    expect(state.paged).toBe(READER_DEFAULTS.paged);
    expect(state.fontSize).toBe(READER_DEFAULTS.fontSize);
    expect(state.lineHeight).toBe(READER_DEFAULTS.lineHeight);
    expect(state.theme).toBe(READER_DEFAULTS.theme);
  });

  it("togglePaged flips paged", () => {
    expect(useReaderStore.getState().paged).toBe(false);
    useReaderStore.getState().togglePaged();
    expect(useReaderStore.getState().paged).toBe(true);
    useReaderStore.getState().togglePaged();
    expect(useReaderStore.getState().paged).toBe(false);
  });

  it("setFontSize clamps below the min", () => {
    useReaderStore.getState().setFontSize(0);
    expect(useReaderStore.getState().fontSize).toBe(12);
  });

  it("setFontSize clamps above the max", () => {
    useReaderStore.getState().setFontSize(999);
    expect(useReaderStore.getState().fontSize).toBe(36);
  });

  it("setFontSize accepts valid in-range values", () => {
    useReaderStore.getState().setFontSize(20);
    expect(useReaderStore.getState().fontSize).toBe(20);
  });

  it("setLineHeight clamps to [1.0, 2.4]", () => {
    useReaderStore.getState().setLineHeight(0.5);
    expect(useReaderStore.getState().lineHeight).toBe(1.0);
    useReaderStore.getState().setLineHeight(5);
    expect(useReaderStore.getState().lineHeight).toBe(2.4);
  });

  it("setTheme sets each valid theme", () => {
    useReaderStore.getState().setTheme("dark");
    expect(useReaderStore.getState().theme).toBe("dark");
    useReaderStore.getState().setTheme("sepia");
    expect(useReaderStore.getState().theme).toBe("sepia");
  });

  it("reset returns to defaults", () => {
    useReaderStore.getState().setPaged(true);
    useReaderStore.getState().setFontSize(30);
    useReaderStore.getState().setTheme("dark");
    useReaderStore.getState().reset();
    const state = useReaderStore.getState();
    expect(state).toMatchObject(READER_DEFAULTS);
  });
});
