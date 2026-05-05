import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Alert,
  Badge,
  Box,
  Button,
  ColorInput,
  Drawer,
  Group,
  NumberInput,
  SegmentedControl,
  Select,
  Slider,
  Stack,
  Switch,
  Tabs,
  Text,
  Textarea,
} from "@mantine/core";
import {
  ReaderContent,
  type ReaderContentHandle,
} from "../components/ReaderContent";
import {
  getAdjacentChapter,
  getChapterById,
  markChapterOpened,
  setChapterBookmark,
  updateChapterProgress,
} from "../db/queries/chapter";
import { readerRoute } from "../router";
import { useLibraryStore } from "../store/library";
import {
  READER_FONT_OPTIONS,
  READER_PRESET_THEMES,
  useReaderStore,
} from "../store/reader";

const SAMPLE_CHAPTER_HTML = `
<h1>Chapter 1 - A long road begins</h1>
<p>
  The wind carried the scent of pine and old rain across the road, and
  for a moment the boy thought he could hear the river even before he
  could see it. He paused at the crest of the hill and looked back the
  way he had come. The village was already a smudge of slate against
  the morning grey. He had not expected leaving to feel this small.
</p>
<p>
  His father had said only that the journey would not be a kind one.
  His mother, who had no patience for either drama or doubt, had
  packed his satchel with practical things: flatbread wrapped in
  oiled paper, three apples, a little sealed pot of honey, the knife
  he had been allowed to whet but not yet to keep, and three coins of
  middling worth.
</p>
<p>
  The road wound down into the valley between elms. He had been told
  they would change colour soon. He had also been told that the wolves
  this year were thin and bold. He hoped neither would inconvenience
  him before sundown.
</p>
<h2>I.</h2>
<p>
  The river crossing came at noon, exactly when his father had said
  it would. There was a stone bridge with a moss-furred handrail and
  a toll-house, and the toll-keeper was asleep against the doorpost
  with a long-stemmed pipe gone cold in his hand. The boy laid one of
  his middling coins on the windowsill and walked across without
  waking him.
</p>
`;

function chapterDetailKey(chapterId: number) {
  return ["chapter", "detail", chapterId] as const;
}

export function ReaderPage() {
  const { chapterId } = readerRoute.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const contentRef = useRef<ReaderContentHandle | null>(null);
  const openedChapterRef = useRef<number | null>(null);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const incognitoMode = useLibraryStore((state) => state.incognitoMode);
  const general = useReaderStore((state) => state.general);
  const appearance = useReaderStore((state) => state.appearance);
  const setGeneral = useReaderStore((state) => state.setGeneral);
  const setAppearance = useReaderStore((state) => state.setAppearance);
  const applyTheme = useReaderStore((state) => state.applyTheme);
  const saveCustomTheme = useReaderStore((state) => state.saveCustomTheme);
  const setLastReadChapter = useReaderStore(
    (state) => state.setLastReadChapter,
  );
  const setNovelPageIndex = useReaderStore((state) => state.setNovelPageIndex);
  const resetReaderSettings = useReaderStore(
    (state) => state.resetReaderSettings,
  );

  const chapterQuery = useQuery({
    queryKey: chapterDetailKey(chapterId),
    queryFn: () => getChapterById(chapterId),
    enabled: chapterId > 0,
  });

  const progressMutation = useMutation({
    mutationFn: (progress: number) =>
      updateChapterProgress(chapterId, progress, {
        recordHistory: !incognitoMode,
    }),
    onMutate: (progress) => {
      queryClient.setQueryData<Awaited<ReturnType<typeof getChapterById>>>(
        chapterDetailKey(chapterId),
        (chapter) =>
          chapter
            ? {
                ...chapter,
                progress,
                unread: progress >= 97 ? false : chapter.unread,
                readAt: incognitoMode
                  ? chapter.readAt
                  : Math.floor(Date.now() / 1000),
              }
            : chapter,
      );
    },
    onSuccess: (_result, progress) => {
      if (!incognitoMode) {
        void queryClient.invalidateQueries({ queryKey: ["chapter", "history"] });
        void queryClient.invalidateQueries({ queryKey: ["novel"] });
      }
      if (progress >= 97) {
        void queryClient.invalidateQueries({ queryKey: ["chapter", "updates"] });
      }
    },
  });
  const progressMutateRef = useRef(progressMutation.mutate);

  useEffect(() => {
    progressMutateRef.current = progressMutation.mutate;
  }, [progressMutation.mutate]);

  const bookmarkMutation = useMutation({
    mutationFn: async () => {
      const chapter = chapterQuery.data;
      if (!chapter) return;
      await setChapterBookmark(chapter.id, !chapter.bookmark);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: chapterDetailKey(chapterId),
      });
    },
  });

  const readerThemes = useMemo(
    () => [...READER_PRESET_THEMES, ...appearance.customThemes],
    [appearance.customThemes],
  );

  const openAdjacent = useCallback(
    async (direction: 1 | -1) => {
      const chapter = chapterQuery.data;
      if (!chapter) return;
      const adjacent = await getAdjacentChapter(
        chapter.novelId,
        chapter.position,
        direction,
      );
      if (adjacent) {
        openedChapterRef.current = null;
        void navigate({ to: "/reader", search: { chapterId: adjacent.id } });
      }
    },
    [chapterQuery.data, navigate],
  );

  useEffect(() => {
    const chapter = chapterQuery.data;
    if (
      !chapter ||
      !chapter.isDownloaded ||
      openedChapterRef.current === chapter.id
    ) {
      return;
    }
    openedChapterRef.current = chapter.id;
    setLastReadChapter(chapter.novelId, chapter.id);
    if (!incognitoMode) {
      void markChapterOpened(chapter.id).then(() => {
        void queryClient.invalidateQueries({ queryKey: ["chapter", "history"] });
        void queryClient.invalidateQueries({ queryKey: ["novel"] });
      });
    }
  }, [chapterQuery.data, incognitoMode, queryClient, setLastReadChapter]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      switch (event.key) {
        case "PageDown":
        case "ArrowDown":
        case " ":
        case "ArrowRight":
          event.preventDefault();
          contentRef.current?.scrollByPage(1);
          break;
        case "PageUp":
        case "ArrowUp":
        case "ArrowLeft":
          event.preventDefault();
          contentRef.current?.scrollByPage(-1);
          break;
        case "Home":
          event.preventDefault();
          contentRef.current?.scrollToStart();
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

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

  const chapter = chapterQuery.data;
  const html = chapter?.content ?? SAMPLE_CHAPTER_HTML;
  const progress = chapter?.progress ?? 0;
  const chapterNovelId = chapter?.novelId;
  const handleProgressChange = useCallback(
    (nextProgress: number) => {
      if (chapterId > 0) {
        progressMutateRef.current(nextProgress);
      }
    },
    [chapterId],
  );
  const handlePageIndexChange = useCallback(
    (pageIndex: number) => {
      if (chapterNovelId) setNovelPageIndex(chapterNovelId, pageIndex);
    },
    [chapterNovelId, setNovelPageIndex],
  );

  return (
    <Box style={{ position: "relative" }}>
      {chromeVisible ? (
        <Group
          gap="xs"
          style={{
            position: "fixed",
            zIndex: 10,
            top: general.fullScreen ? 8 : 64,
            left: 12,
            right: 12,
            justifyContent: "space-between",
            pointerEvents: "none",
          }}
        >
          <Group gap="xs" style={{ pointerEvents: "auto" }}>
            <Button size="xs" variant="default" onClick={() => setSettingsOpen(true)}>
              Settings
            </Button>
            {chapter ? (
              <Button
                size="xs"
                variant={chapter.bookmark ? "light" : "default"}
                loading={bookmarkMutation.isPending}
                onClick={() => bookmarkMutation.mutate()}
              >
                {chapter.bookmark ? "Bookmarked" : "Bookmark"}
              </Button>
            ) : null}
          </Group>
          <Group gap="xs" style={{ pointerEvents: "auto" }}>
            {incognitoMode ? (
              <Badge variant="light" color="gray">
                Incognito
              </Badge>
            ) : null}
            {chapter ? (
              <Badge variant="light">
                {chapter.name} - {Math.round(progress)}%
              </Badge>
            ) : null}
            <Button size="xs" variant="default" onClick={() => setChromeVisible(false)}>
              Hide
            </Button>
          </Group>
        </Group>
      ) : null}

      {chapterId > 0 && chapterQuery.isLoading ? (
        <Box p="lg">
          <Alert color="blue" title="Loading chapter">
            Loading reader content...
          </Alert>
        </Box>
      ) : chapterId > 0 && chapterQuery.error ? (
        <Box p="lg">
          <Alert color="red" title="Failed to load chapter">
            {chapterQuery.error instanceof Error
              ? chapterQuery.error.message
              : String(chapterQuery.error)}
          </Alert>
        </Box>
      ) : chapterId > 0 && chapterQuery.data === null ? (
        <Box p="lg">
          <Alert color="orange" title="Chapter not found">
            No chapter row with id {chapterId} exists in the local DB.
          </Alert>
        </Box>
      ) : chapterId > 0 && chapter && !chapter.isDownloaded ? (
        <Box p="lg">
          <Alert color="blue" title="Not downloaded yet">
            Open this chapter from the novel detail screen and tap
            "Download" to fetch its body before reading offline.
          </Alert>
        </Box>
      ) : (
        <ReaderContent
          ref={contentRef}
          html={html}
          initialProgress={progress}
          onProgressChange={handleProgressChange}
          onPageIndexChange={handlePageIndexChange}
          onToggleChrome={() => setChromeVisible((visible) => !visible)}
          onBoundaryPage={(direction) => {
            void openAdjacent(direction);
          }}
        />
      )}

      <Drawer
        opened={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="Reader settings"
        position="right"
        size="md"
      >
        <Tabs defaultValue="display">
          <Tabs.List>
            <Tabs.Tab value="display">Display</Tabs.Tab>
            <Tabs.Tab value="controls">Controls</Tabs.Tab>
            <Tabs.Tab value="advanced">Advanced</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="display" pt="md">
            <Stack gap="md">
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
              <Group grow>
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
              </Group>
              <Stack gap={4}>
                <Group justify="space-between">
                  <Text size="sm">Text size</Text>
                  <Text size="sm" c="dimmed">
                    {appearance.textSize}px
                  </Text>
                </Group>
                <Slider
                  min={12}
                  max={36}
                  step={1}
                  value={appearance.textSize}
                  onChange={(textSize) => setAppearance({ textSize })}
                />
              </Stack>
              <Stack gap={4}>
                <Group justify="space-between">
                  <Text size="sm">Line height</Text>
                  <Text size="sm" c="dimmed">
                    {appearance.lineHeight.toFixed(2)}
                  </Text>
                </Group>
                <Slider
                  min={1}
                  max={2.6}
                  step={0.05}
                  value={appearance.lineHeight}
                  onChange={(lineHeight) => setAppearance({ lineHeight })}
                />
              </Stack>
              <Stack gap={4}>
                <Group justify="space-between">
                  <Text size="sm">Padding</Text>
                  <Text size="sm" c="dimmed">
                    {appearance.padding}px
                  </Text>
                </Group>
                <Slider
                  min={0}
                  max={64}
                  step={1}
                  value={appearance.padding}
                  onChange={(padding) => setAppearance({ padding })}
                />
              </Stack>
              <Select
                label="Font"
                data={READER_FONT_OPTIONS}
                value={appearance.fontFamily}
                onChange={(fontFamily) =>
                  setAppearance({ fontFamily: fontFamily ?? "" })
                }
              />
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
              <Group>
                <Button variant="default" onClick={handleSaveCustomTheme}>
                  Save custom theme
                </Button>
                <Button variant="default" onClick={resetReaderSettings}>
                  Reset
                </Button>
              </Group>
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="controls" pt="md">
            <Stack gap="sm">
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
              <Switch
                label="Paged reader"
                checked={general.pageReader}
                onChange={(event) =>
                  setGeneral({ pageReader: event.currentTarget.checked })
                }
              />
              <Switch
                label="Swipe gestures"
                checked={general.swipeGestures}
                onChange={(event) =>
                  setGeneral({ swipeGestures: event.currentTarget.checked })
                }
              />
              <Switch
                label="Tap to scroll"
                checked={general.tapToScroll}
                onChange={(event) =>
                  setGeneral({ tapToScroll: event.currentTarget.checked })
                }
              />
              <Switch
                label="Seekbar"
                checked={general.showSeekbar}
                onChange={(event) =>
                  setGeneral({ showSeekbar: event.currentTarget.checked })
                }
              />
              <Switch
                label="Vertical seekbar"
                checked={general.verticalSeekbar}
                onChange={(event) =>
                  setGeneral({ verticalSeekbar: event.currentTarget.checked })
                }
              />
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
              <Switch
                label="Auto-scroll"
                checked={general.autoScroll}
                onChange={(event) =>
                  setGeneral({ autoScroll: event.currentTarget.checked })
                }
              />
              <Group grow>
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
              </Group>
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="advanced" pt="md">
            <Stack gap="md">
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
          </Tabs.Panel>
        </Tabs>
      </Drawer>
    </Box>
  );
}
