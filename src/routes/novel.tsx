import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Alert,
  Badge,
  Box,
  Button,
  Container,
  Divider,
  Group,
  Image,
  Loader,
  Paper,
  Progress,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { listChaptersByNovel, type ChapterRow } from "../db/queries/chapter";
import {
  getNovelById,
  setNovelInLibrary,
  type NovelDetailRecord,
} from "../db/queries/novel";
import { downloadQueue, type DownloadStatus } from "../lib/download/queue";
import { pluginManager } from "../lib/plugins/manager";
import { novelRoute } from "../router";
import { useLibraryStore } from "../store/library";
import { useReaderStore } from "../store/reader";
import { useSiteBrowserStore } from "../store/site-browser";

const FALLBACK_COVER = "https://placehold.co/200x300?text=No+Cover";

function novelKey(id: number) {
  return ["novel", "detail", id] as const;
}

function chaptersKey(id: number) {
  return ["novel", "detail", id, "chapters"] as const;
}

function formatDate(epoch: number | null): string {
  if (!epoch) return "Never";
  return new Date(epoch * 1000).toLocaleDateString();
}

function splitGenres(genres: string | null): string[] {
  if (!genres) return [];
  return genres
    .split(/[|,]/)
    .map((genre) => genre.trim())
    .filter(Boolean);
}

function cssUrl(url: string): string {
  return `url("${url.replace(/"/g, '\\"')}")`;
}

function findReadableChapter(
  chapters: ChapterRow[],
  lastReadChapterId: number | undefined,
): ChapterRow | null {
  return (
    chapters.find((chapter) => chapter.id === lastReadChapterId) ??
    chapters.find((chapter) => chapter.progress > 0 && chapter.progress < 100) ??
    chapters.find((chapter) => chapter.unread) ??
    chapters[0] ??
    null
  );
}

function resolveNovelSourceUrl(novel: NovelDetailRecord): string | null {
  if (novel.isLocal) return null;

  const plugin = pluginManager.getPlugin(novel.pluginId);
  if (!plugin) return null;

  if (plugin.resolveUrl) {
    try {
      const resolved = plugin.resolveUrl(novel.path, true);
      if (resolved) return resolved;
    } catch {
      // Fall back to resolving the path against the plugin site below.
    }
  }

  try {
    return new URL(novel.path, plugin.site).toString();
  } catch {
    return plugin.site || null;
  }
}

interface ChapterListItemProps {
  chapter: ChapterRow;
  status: DownloadStatus | undefined;
  onOpen: () => void;
  onDownload: () => void;
}

function ChapterListItem({
  chapter,
  status,
  onOpen,
  onDownload,
}: ChapterListItemProps) {
  const isQueued = status?.kind === "queued";
  const isRunning = status?.kind === "running";
  const failedMessage = status?.kind === "failed" ? status.error : null;
  const showDownloadButton =
    !chapter.isDownloaded && !isQueued && !isRunning;

  return (
    <Paper
      p="sm"
      radius="sm"
      withBorder
      onClick={onOpen}
      role="button"
      tabIndex={0}
      style={{ cursor: "pointer" }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Stack gap={4} style={{ minWidth: 0, flex: 1 }}>
          <Text
            fw={chapter.unread ? 500 : 400}
            lineClamp={1}
            title={chapter.name}
          >
            {chapter.name}
          </Text>
          <Group gap="xs">
            <Text size="xs" c="dimmed">
              #{chapter.position}
            </Text>
            {chapter.bookmark && (
              <Badge size="xs" color="yellow" variant="light">
                Bookmark
              </Badge>
            )}
            {chapter.isDownloaded && (
              <Badge size="xs" color="teal" variant="light">
                Downloaded
              </Badge>
            )}
            {isQueued && (
              <Badge size="xs" color="gray" variant="light">
                Queued
              </Badge>
            )}
            {isRunning && (
              <Badge size="xs" color="blue" variant="light">
                Downloading
              </Badge>
            )}
            {failedMessage && (
              <Badge size="xs" color="red" variant="light" title={failedMessage}>
                Failed
              </Badge>
            )}
            {!chapter.unread && (
              <Badge size="xs" color="gray" variant="light">
                Read
              </Badge>
            )}
          </Group>
        </Stack>
        <Group gap="xs" wrap="nowrap" align="center">
          {chapter.progress > 0 && chapter.progress < 100 && (
            <Progress
              value={chapter.progress}
              size="xs"
              style={{ width: 60 }}
            />
          )}
          {showDownloadButton && (
            <Button
              size="xs"
              variant="light"
              onClick={(event) => {
                event.stopPropagation();
                onDownload();
              }}
            >
              {failedMessage ? "Retry" : "Download"}
            </Button>
          )}
        </Group>
      </Group>
    </Paper>
  );
}

interface NovelHeroProps {
  novel: NovelDetailRecord;
  chapters: ChapterRow[];
  lastReadChapterId: number | undefined;
  onBack: () => void;
  onRead: (chapterId: number) => void;
  onOpenSource: () => void;
  onToggleLibrary: () => void;
  sourceUrl: string | null;
  toggleBusy: boolean;
}

function NovelHero({
  novel,
  chapters,
  lastReadChapterId,
  onBack,
  onRead,
  onOpenSource,
  onToggleLibrary,
  sourceUrl,
  toggleBusy,
}: NovelHeroProps) {
  const cover = novel.cover ?? FALLBACK_COVER;
  const genres = splitGenres(novel.genres);
  const readableChapter = findReadableChapter(chapters, lastReadChapterId);
  const readLabel =
    readableChapter && readableChapter.progress > 0
      ? "Continue reading"
      : "Start reading";

  return (
    <Box
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: 8,
        backgroundColor: "#151515",
      }}
    >
      <Box
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: cssUrl(cover),
          backgroundPosition: "center",
          backgroundSize: "cover",
          filter: "blur(16px)",
          opacity: 0.32,
          transform: "scale(1.08)",
        }}
      />
      <Box
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(90deg, rgba(10, 10, 10, 0.92), rgba(20, 20, 20, 0.74) 52%, rgba(20, 20, 20, 0.48))",
        }}
      />

      <Stack
        gap="lg"
        p={{ base: "md", sm: "xl" }}
        style={{ position: "relative", zIndex: 1 }}
      >
        <Group justify="space-between" align="center" gap="sm">
          <Button variant="light" color="gray" onClick={onBack}>
            Back
          </Button>
          <Text size="sm" c="gray.3" ta="right">
            Source: {novel.pluginId}
          </Text>
        </Group>

        <Group align="flex-end" gap="xl" wrap="wrap">
          <Image
            src={cover}
            fallbackSrc={FALLBACK_COVER}
            w={176}
            h={264}
            alt={novel.name}
            radius="sm"
            fit="cover"
            style={{
              boxShadow: "0 18px 48px rgba(0, 0, 0, 0.42)",
              flexShrink: 0,
            }}
          />

          <Stack gap="sm" style={{ flex: 1, minWidth: 260 }}>
            <Stack gap={4}>
              <Title order={1} c="white" lineClamp={3}>
                {novel.name}
              </Title>
              {novel.author && (
                <Text c="gray.2" size="sm">
                  Author: {novel.author}
                </Text>
              )}
              {novel.artist && novel.artist !== novel.author && (
                <Text c="gray.3" size="sm">
                  Artist: {novel.artist}
                </Text>
              )}
            </Stack>

            <Group gap="xs" wrap="wrap">
              {novel.status && (
                <Badge variant="filled" color="blue">
                  {novel.status}
                </Badge>
              )}
              {novel.isLocal && (
                <Badge variant="filled" color="grape">
                  Local
                </Badge>
              )}
              {novel.inLibrary && (
                <Badge variant="filled" color="green">
                  In library
                </Badge>
              )}
              {genres.slice(0, 5).map((genre) => (
                <Badge key={genre} variant="light" color="gray">
                  {genre}
                </Badge>
              ))}
            </Group>

            <Group gap="md" c="gray.3">
              <Text size="sm">Last read: {formatDate(novel.lastReadAt)}</Text>
              <Text size="sm">Updated: {formatDate(novel.updatedAt)}</Text>
              <Text size="sm">{chapters.length} chapters</Text>
            </Group>

            <Group gap="sm" mt="xs">
              <Button
                onClick={() => readableChapter && onRead(readableChapter.id)}
                disabled={!readableChapter}
              >
                {readLabel}
              </Button>
              <Button
                onClick={onToggleLibrary}
                loading={toggleBusy}
                variant={novel.inLibrary ? "default" : "light"}
                color={novel.inLibrary ? "gray" : "blue"}
              >
                {novel.inLibrary ? "Remove from library" : "Add to library"}
              </Button>
              <Button
                onClick={onOpenSource}
                disabled={!sourceUrl}
                variant="light"
                color="gray"
              >
                Open source
              </Button>
            </Group>
          </Stack>
        </Group>
      </Stack>
    </Box>
  );
}

interface NovelSummaryProps {
  novel: NovelDetailRecord;
}

function NovelSummary({ novel }: NovelSummaryProps) {
  const genres = splitGenres(novel.genres);

  if (!novel.summary && genres.length === 0) {
    return null;
  }

  return (
    <Stack gap="md">
      {novel.summary && (
        <Stack gap="xs">
          <Title order={4}>Summary</Title>
          <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
            {novel.summary}
          </Text>
        </Stack>
      )}

      {genres.length > 0 && (
        <Stack gap="xs">
          <Title order={5}>Genres</Title>
          <Group gap="xs" wrap="wrap">
            {genres.map((genre) => (
              <Badge key={genre} variant="default">
                {genre}
              </Badge>
            ))}
          </Group>
        </Stack>
      )}
    </Stack>
  );
}

export function NovelDetailPage() {
  const { id } = novelRoute.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const defaultChapterSort = useLibraryStore((s) => s.defaultChapterSort);
  const openSiteBrowser = useSiteBrowserStore((s) => s.openAt);
  const lastReadChapterId = useReaderStore(
    (state) => state.lastReadChapterByNovel[id],
  );

  const novelQuery = useQuery({
    queryKey: novelKey(id),
    queryFn: () => getNovelById(id),
    enabled: id > 0,
  });

  const chaptersQuery = useQuery({
    queryKey: chaptersKey(id),
    queryFn: () => listChaptersByNovel(id),
    enabled: id > 0,
  });

  const toggle = useMutation({
    mutationFn: async () => {
      const novel = novelQuery.data;
      if (!novel) return;
      await setNovelInLibrary(novel.id, !novel.inLibrary);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["novel"] });
    },
  });

  const [statuses, setStatuses] = useState<
    ReadonlyMap<number, DownloadStatus>
  >(() => new Map());

  useEffect(() => {
    return downloadQueue.subscribe((event) => {
      setStatuses((prev) => {
        const next = new Map(prev);
        next.set(event.job.id, event.status);
        return next;
      });
      if (event.status.kind === "done") {
        void queryClient.invalidateQueries({
          queryKey: chaptersKey(id),
        });
      }
    });
  }, [id, queryClient]);

  function goBack() {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }

    void navigate({ to: "/" });
  }

  function openChapter(chapterId: number) {
    void navigate({ to: "/reader", search: { chapterId } });
  }

  function openSourceNovel(url: string | null) {
    if (!url) return;
    openSiteBrowser(url);
  }

  function downloadChapter(chapter: ChapterRow): void {
    const novel = novelQuery.data;
    if (!novel) return;
    downloadQueue.enqueue({
      id: chapter.id,
      pluginId: novel.pluginId,
      chapterPath: chapter.path,
    });
  }

  if (id <= 0) {
    return (
      <Container py="lg" size="lg">
        <Alert color="yellow" title="Missing id">
          The novel detail screen needs an id query parameter.
        </Alert>
      </Container>
    );
  }

  if (novelQuery.isLoading) {
    return (
      <Container py="lg" size="lg">
        <Group gap="sm">
          <Loader size="sm" />
          <Text c="dimmed">Loading novel...</Text>
        </Group>
      </Container>
    );
  }

  if (novelQuery.error) {
    return (
      <Container py="lg" size="lg">
        <Alert color="red" title="Failed to load novel">
          {novelQuery.error instanceof Error
            ? novelQuery.error.message
            : String(novelQuery.error)}
        </Alert>
      </Container>
    );
  }

  const novel = novelQuery.data;
  if (!novel) {
    return (
      <Container py="lg" size="lg">
        <Alert color="orange" title="Not found">
          No novel matches id {id}.
        </Alert>
      </Container>
    );
  }

  const rows = chaptersQuery.data ?? [];
  const chapters =
    defaultChapterSort === "desc" ? [...rows].reverse() : rows;
  const sourceUrl = resolveNovelSourceUrl(novel);
  const downloadedCount = chapters.filter(
    (chapter) => chapter.isDownloaded,
  ).length;
  const unreadCount = chapters.filter((chapter) => chapter.unread).length;

  return (
    <Container py="lg" size="lg">
      <Stack gap="xl">
        <NovelHero
          novel={novel}
          chapters={chapters}
          lastReadChapterId={lastReadChapterId}
          onBack={goBack}
          onRead={openChapter}
          onOpenSource={() => openSourceNovel(sourceUrl)}
          onToggleLibrary={() => toggle.mutate()}
          sourceUrl={sourceUrl}
          toggleBusy={toggle.isPending}
        />

        <NovelSummary novel={novel} />

        <Divider />

        <Stack gap="sm">
          <Group justify="space-between" align="baseline" gap="sm">
            <Title order={4}>Chapters</Title>
            <Group gap="xs">
              <Badge variant="light" color="blue">
                {chapters.length} total
              </Badge>
              <Badge variant="light" color="teal">
                {downloadedCount} downloaded
              </Badge>
              <Badge variant="light" color="gray">
                {unreadCount} unread
              </Badge>
            </Group>
          </Group>

          {chaptersQuery.isLoading ? (
            <Group gap="sm">
              <Loader size="sm" />
              <Text c="dimmed">Loading chapters...</Text>
            </Group>
          ) : chapters.length === 0 ? (
            <Alert color="blue" variant="light">
              No chapters indexed yet for this novel.
            </Alert>
          ) : (
            <Stack gap="xs">
              {chapters.map((chapter) => (
                <ChapterListItem
                  key={chapter.id}
                  chapter={chapter}
                  status={statuses.get(chapter.id)}
                  onOpen={() => openChapter(chapter.id)}
                  onDownload={() => downloadChapter(chapter)}
                />
              ))}
            </Stack>
          )}
        </Stack>
      </Stack>
    </Container>
  );
}
