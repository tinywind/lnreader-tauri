import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Alert,
  Badge,
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
import { novelRoute } from "../router";

const FALLBACK_COVER = "https://placehold.co/200x300?text=No+Cover";

function novelKey(id: number) {
  return ["novel", "detail", id] as const;
}

function chaptersKey(id: number) {
  return ["novel", "detail", id, "chapters"] as const;
}

function formatDate(epoch: number | null): string {
  if (!epoch) return "—";
  return new Date(epoch * 1000).toLocaleDateString();
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
                Downloading…
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

interface NovelHeaderProps {
  novel: NovelDetailRecord;
  onToggleLibrary: () => void;
  toggleBusy: boolean;
}

function NovelHeader({ novel, onToggleLibrary, toggleBusy }: NovelHeaderProps) {
  return (
    <Group align="flex-start" gap="lg" wrap="nowrap">
      <Image
        src={novel.cover ?? FALLBACK_COVER}
        fallbackSrc={FALLBACK_COVER}
        w={180}
        h={270}
        alt={novel.name}
        radius="sm"
      />
      <Stack gap="xs" style={{ flex: 1, minWidth: 0 }}>
        <Title order={2}>{novel.name}</Title>
        {novel.author && <Text size="sm">by {novel.author}</Text>}
        {novel.artist && novel.artist !== novel.author && (
          <Text size="sm" c="dimmed">
            art: {novel.artist}
          </Text>
        )}
        <Group gap="xs" wrap="wrap">
          {novel.status && (
            <Badge variant="light" color="blue">
              {novel.status}
            </Badge>
          )}
          {novel.isLocal && (
            <Badge variant="light" color="grape">
              Local
            </Badge>
          )}
          {novel.genres &&
            novel.genres
              .split(",")
              .map((g) => g.trim())
              .filter(Boolean)
              .slice(0, 4)
              .map((g) => (
                <Badge key={g} variant="default">
                  {g}
                </Badge>
              ))}
        </Group>
        <Text size="xs" c="dimmed">
          Last read: {formatDate(novel.lastReadAt)}
        </Text>
        <Group gap="sm" mt="sm">
          <Button
            onClick={onToggleLibrary}
            loading={toggleBusy}
            variant={novel.inLibrary ? "default" : "filled"}
          >
            {novel.inLibrary ? "Remove from library" : "Add to library"}
          </Button>
        </Group>
      </Stack>
    </Group>
  );
}

export function NovelDetailPage() {
  const { id } = novelRoute.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

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

  function openChapter(chapterId: number) {
    void navigate({ to: "/reader", search: { chapterId } });
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
          The novel detail screen needs an `id` query parameter.
        </Alert>
      </Container>
    );
  }

  if (novelQuery.isLoading) {
    return (
      <Container py="lg" size="lg">
        <Group gap="sm">
          <Loader size="sm" />
          <Text c="dimmed">Loading novel…</Text>
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

  const chapters = chaptersQuery.data ?? [];

  return (
    <Container py="lg" size="lg">
      <Stack gap="lg">
        <NovelHeader
          novel={novel}
          onToggleLibrary={() => toggle.mutate()}
          toggleBusy={toggle.isPending}
        />

        {novel.summary && (
          <Stack gap="xs">
            <Title order={5}>Summary</Title>
            <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
              {novel.summary}
            </Text>
          </Stack>
        )}

        <Divider />

        <Stack gap="sm">
          <Group justify="space-between" align="baseline">
            <Title order={4}>Chapters</Title>
            <Text size="sm" c="dimmed">
              {chapters.length} total
            </Text>
          </Group>
          {chaptersQuery.isLoading ? (
            <Group gap="sm">
              <Loader size="sm" />
              <Text c="dimmed">Loading chapters…</Text>
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
