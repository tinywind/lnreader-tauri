import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ActionIcon,
  Alert,
  Container,
  Divider,
  Group,
  Paper,
  SegmentedControl,
  Slider,
  Stack,
  Switch,
  Text,
  Title,
} from "@mantine/core";
import {
  ReaderContent,
  type ClickZone,
  type ReaderContentHandle,
} from "../components/ReaderContent";
import { getChapterById } from "../db/queries/chapter";
import { readerRoute } from "../router";
import { useReaderStore, type ReaderTheme } from "../store/reader";

const SAMPLE_CHAPTER_HTML = `
<h1>Chapter 1 — A long road begins</h1>
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
  packed his satchel with practical things — flatbread wrapped in
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
<p>
  On the other side the country opened out. Wheat had been brought
  in, and the fields lay yellow and clean. Crows turned in the air
  above the gleanings. The boy ate one of his apples and threw the
  core to the nearest crow as a courtesy.
</p>
<p>
  The day grew warm, then cooled. He passed two travellers — a man
  with a goat on a string, and a woman with a sleeping baby slung
  across her chest — and he greeted each of them politely in the way
  his mother had drilled into him. They greeted him back the way
  travellers do: tired, kind enough, in no mood to say more.
</p>
<h2>II.</h2>
<p>
  Toward evening he came upon a stand of elms ringed by a low stone
  wall. Inside the ring there was a well, and beside the well there
  was a bench, and on the bench there was a woman so small and still
  that for a moment the boy mistook her for a heap of cloth left
  there to dry. Then she opened her eyes.
</p>
<p>
  "You are walking late," she said, and her voice was the voice of
  someone who had been awake a long time but did not particularly
  mind it. "Where are you going?"
</p>
<p>
  He told her where he was going. She nodded, not surprised, the way
  a wood-cutter nods when told a tree will fall in winter. Then she
  asked his name, and he told her that too.
</p>
<p>
  "Rest a while," she said, and made room on the bench. "The wolves
  this year are thin and bold, and the road past these elms is no
  road for a tired boy."
</p>
`;

export function ReaderPage() {
  const { chapterId } = readerRoute.useSearch();
  const chapterQuery = useQuery({
    queryKey: ["chapter", "detail", chapterId] as const,
    queryFn: () => getChapterById(chapterId),
    enabled: chapterId > 0,
  });

  const paged = useReaderStore((s) => s.paged);
  const fontSize = useReaderStore((s) => s.fontSize);
  const lineHeight = useReaderStore((s) => s.lineHeight);
  const theme = useReaderStore((s) => s.theme);
  const togglePaged = useReaderStore((s) => s.togglePaged);
  const setFontSize = useReaderStore((s) => s.setFontSize);
  const setLineHeight = useReaderStore((s) => s.setLineHeight);
  const setTheme = useReaderStore((s) => s.setTheme);
  const reset = useReaderStore((s) => s.reset);

  const contentRef = useRef<ReaderContentHandle | null>(null);
  const [chromeVisible, setChromeVisible] = useState(true);

  const goNext = useCallback(() => {
    contentRef.current?.scrollByPage(1);
  }, []);
  const goPrev = useCallback(() => {
    contentRef.current?.scrollByPage(-1);
  }, []);

  const handleClickZone = useCallback(
    (zone: ClickZone) => {
      if (zone === "top") {
        goPrev();
      } else if (zone === "bottom") {
        goNext();
      } else {
        setChromeVisible((open) => !open);
      }
    },
    [goNext, goPrev],
  );

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      // Ignore when focus is in a form control (Slider, Input, etc).
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
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
          goNext();
          break;
        case "PageUp":
        case "ArrowUp":
        case "ArrowLeft":
          event.preventDefault();
          goPrev();
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
  }, [goNext, goPrev]);

  return (
    <Stack gap={0}>
      {chromeVisible ? (
        <>
          <Container size="lg" py="md">
            <Paper withBorder p="md" radius="md">
              <Stack gap="sm">
                <Group justify="space-between" align="baseline">
                  <Title order={3}>Reader settings</Title>
                  <Group gap="xs">
                    <ActionIcon
                      variant="subtle"
                      size="sm"
                      onClick={() => setChromeVisible(false)}
                      aria-label="Hide chrome"
                    >
                      –
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      size="sm"
                      onClick={reset}
                      aria-label="Reset reader settings"
                    >
                      ↺
                    </ActionIcon>
                  </Group>
                </Group>

                <Group justify="space-between" wrap="nowrap">
                  <Text size="sm">Paged mode</Text>
                  <Switch checked={paged} onChange={togglePaged} />
                </Group>

                <Stack gap={2}>
                  <Group justify="space-between">
                    <Text size="sm">Font size</Text>
                    <Text size="sm" c="dimmed">
                      {fontSize}px
                    </Text>
                  </Group>
                  <Slider
                    min={12}
                    max={36}
                    step={1}
                    value={fontSize}
                    onChange={setFontSize}
                    marks={[
                      { value: 14, label: "14" },
                      { value: 20, label: "20" },
                      { value: 28, label: "28" },
                    ]}
                  />
                </Stack>

                <Stack gap={2}>
                  <Group justify="space-between">
                    <Text size="sm">Line height</Text>
                    <Text size="sm" c="dimmed">
                      {lineHeight.toFixed(2)}
                    </Text>
                  </Group>
                  <Slider
                    min={1.0}
                    max={2.4}
                    step={0.05}
                    value={lineHeight}
                    onChange={setLineHeight}
                    marks={[
                      { value: 1.2, label: "1.2" },
                      { value: 1.6, label: "1.6" },
                      { value: 2.0, label: "2.0" },
                    ]}
                  />
                </Stack>

                <Group justify="space-between">
                  <Text size="sm">Theme</Text>
                  <SegmentedControl
                    size="xs"
                    value={theme}
                    onChange={(value) => setTheme(value as ReaderTheme)}
                    data={[
                      { value: "light", label: "Light" },
                      { value: "sepia", label: "Sepia" },
                      { value: "dark", label: "Dark" },
                    ]}
                  />
                </Group>

                <Text size="xs" c="dimmed">
                  Click the top/bottom thirds of the page to navigate.
                  Click the middle third to hide/show this panel.
                  Keyboard: PageDown / ArrowDown / Space → next,
                  PageUp / ArrowUp → previous, Home → start.
                </Text>
              </Stack>
            </Paper>
          </Container>
          <Divider />
        </>
      ) : null}

      {chapterId > 0 && chapterQuery.data === null ? (
        <Container size="lg" py="md">
          <Alert color="orange" title="Chapter not found">
            No chapter row with id {chapterId} exists in the local DB.
          </Alert>
        </Container>
      ) : chapterId > 0 &&
        chapterQuery.data &&
        !chapterQuery.data.isDownloaded ? (
        <Container size="lg" py="md">
          <Alert color="blue" title="Not downloaded yet">
            Open this chapter from the novel detail screen and tap
            "Download" to fetch its body before reading offline.
          </Alert>
        </Container>
      ) : (
        <ReaderContent
          ref={contentRef}
          html={chapterQuery.data?.content ?? SAMPLE_CHAPTER_HTML}
          onClickZone={handleClickZone}
        />
      )}
    </Stack>
  );
}
