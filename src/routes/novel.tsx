import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Button,
  Group,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import {
  ConsoleChip,
  ConsoleCover,
  ConsolePanel,
  ConsoleProgress,
  ConsoleSectionHeader,
  ConsoleStatusDot,
  ConsoleStatusStrip,
} from "../components/ConsolePrimitives";
import { PageFrame, StateView } from "../components/AppFrame";
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
import "../styles/novel.css";

const FALLBACK_COVER = "https://placehold.co/200x300?text=No+Cover";
const FINISHED_PROGRESS = 100;

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

function getChapterReadingProgress(chapter: ChapterRow): number {
  if (chapter.progress >= FINISHED_PROGRESS) return 100;
  return Math.max(0, Math.min(100, Math.round(chapter.progress)));
}

function isChapterFinished(chapter: ChapterRow): boolean {
  return getChapterReadingProgress(chapter) >= 100;
}

function getNovelReadingPercent(chapters: readonly ChapterRow[]): number {
  if (chapters.length === 0) return 0;
  const total = chapters.reduce(
    (sum, chapter) => sum + getChapterReadingProgress(chapter),
    0,
  );
  return Math.round(total / chapters.length);
}

function findReadableChapter(
  chapters: ChapterRow[],
  lastReadChapterId: number | undefined,
): ChapterRow | null {
  const lastReadChapter = chapters.find(
    (chapter) => chapter.id === lastReadChapterId,
  );
  if (lastReadChapter && !isChapterFinished(lastReadChapter)) {
    return lastReadChapter;
  }

  const inProgressChapter = chapters.find(
    (chapter) => chapter.progress > 0 && !isChapterFinished(chapter),
  );
  if (inProgressChapter) return inProgressChapter;

  if (lastReadChapter) {
    const nextChapter = chapters.reduce<ChapterRow | null>(
      (next, chapter) => {
        if (chapter.position <= lastReadChapter.position) return next;
        if (!next || chapter.position < next.position) return chapter;
        return next;
      },
      null,
    );
    if (nextChapter) return nextChapter;
  }

  return chapters.find((chapter) => chapter.unread) ?? chapters[0] ?? null;
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

function chapterProgressStatus(
  chapter: ChapterRow,
): "active" | "done" | "idle" {
  if (isChapterFinished(chapter)) return "done";
  if (chapter.progress > 0) return "active";
  return "idle";
}

interface ChapterDownloadChipProps {
  chapter: ChapterRow;
  status: DownloadStatus | undefined;
}

function ChapterDownloadChip({ chapter, status }: ChapterDownloadChipProps) {
  if (status?.kind === "failed") {
    return (
      <span title={status.error}>
        <ConsoleChip tone="error">failed</ConsoleChip>
      </span>
    );
  }

  if (status?.kind === "running") {
    return <ConsoleChip tone="accent">downloading</ConsoleChip>;
  }

  if (status?.kind === "queued") {
    return <ConsoleChip>queued</ConsoleChip>;
  }

  if (chapter.isDownloaded) {
    return <ConsoleChip tone="success">downloaded</ConsoleChip>;
  }

  return null;
}

interface ChapterListItemProps {
  chapter: ChapterRow;
  isCurrent: boolean;
  status: DownloadStatus | undefined;
  onOpen: () => void;
  onDownload: () => void;
}

function ChapterListItem({
  chapter,
  isCurrent,
  status,
  onOpen,
  onDownload,
}: ChapterListItemProps) {
  const isQueued = status?.kind === "queued";
  const isRunning = status?.kind === "running";
  const failedMessage = status?.kind === "failed" ? status.error : null;
  const showDownloadButton =
    !chapter.isDownloaded && !isQueued && !isRunning;
  const progressStatus = chapterProgressStatus(chapter);

  return (
    <div
      className={`lnr-novel-chapter-row${
        isCurrent ? " lnr-novel-chapter-row--current" : ""
      }`}
      role="button"
      tabIndex={0}
      aria-label={`Open ${chapter.name}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onOpen();
      }}
    >
      <div className="lnr-novel-chapter-position">
        <span>#{chapter.position}</span>
        {isCurrent ? <ConsoleStatusDot status="active" label="current" /> : null}
      </div>

      <div className="lnr-novel-chapter-main">
        <Text
          className="lnr-novel-chapter-title"
          data-read={!chapter.unread}
          title={chapter.name}
        >
          {chapter.name}
        </Text>
        <Group gap="xs" mt={4} wrap="wrap">
          {chapter.chapterNumber ? (
            <Text className="lnr-novel-chapter-meta">
              Ch. {chapter.chapterNumber}
            </Text>
          ) : null}
          {chapter.releaseTime ? (
            <Text className="lnr-novel-chapter-meta">
              Released {chapter.releaseTime}
            </Text>
          ) : null}
          {chapter.bookmark ? <ConsoleChip tone="warning">bookmark</ConsoleChip> : null}
          {!chapter.unread ? <ConsoleChip>read</ConsoleChip> : null}
          <ChapterDownloadChip chapter={chapter} status={status} />
        </Group>
      </div>

      <div className="lnr-novel-chapter-progress">
        <ConsoleProgress value={chapter.progress} status={progressStatus} />
        <span>{Math.round(chapter.progress)}%</span>
      </div>

      <div className="lnr-novel-chapter-actions">
        {showDownloadButton ? (
          <Button
            size="xs"
            variant="light"
            color={failedMessage ? "red" : "gray"}
            title={failedMessage ?? undefined}
            onClick={(event) => {
              event.stopPropagation();
              onDownload();
            }}
          >
            {failedMessage ? "Retry" : "Download"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

interface NovelWorkspaceProps {
  chapters: ChapterRow[];
  downloadedCount: number;
  lastReadChapterId: number | undefined;
  novel: NovelDetailRecord;
  onBack: () => void;
  onOpenSource: () => void;
  onRead: (chapterId: number) => void;
  onToggleLibrary: () => void;
  sourceUrl: string | null;
  toggleBusy: boolean;
  unreadCount: number;
}

function NovelWorkspace({
  chapters,
  downloadedCount,
  lastReadChapterId,
  novel,
  onBack,
  onOpenSource,
  onRead,
  onToggleLibrary,
  sourceUrl,
  toggleBusy,
  unreadCount,
}: NovelWorkspaceProps) {
  const genres = splitGenres(novel.genres);
  const readableChapter = findReadableChapter(chapters, lastReadChapterId);
  const readPercent = getNovelReadingPercent(chapters);
  const readLabel = readPercent > 0 ? "Continue reading" : "Start reading";

  return (
    <div className="lnr-novel-workspace">
      <ConsolePanel className="lnr-novel-cover-panel">
        <ConsoleCover
          alt={novel.name}
          fallbackSrc={FALLBACK_COVER}
          height={204}
          src={novel.cover}
          width={136}
        />
        <ConsoleStatusStrip className="lnr-novel-cover-strip">
          <span>{chapters.length} chapters</span>
          <span>{downloadedCount} cached</span>
        </ConsoleStatusStrip>
      </ConsolePanel>

      <ConsolePanel className="lnr-novel-info-panel">
        <Text className="lnr-console-kicker">/novel/{novel.id}</Text>
        <div className="lnr-novel-title-row">
          <div className="lnr-novel-title-copy">
            <Title className="lnr-novel-title" order={1}>
              {novel.name}
            </Title>
            <Group gap="xs" mt={6} wrap="wrap">
              {novel.author ? (
                <Text className="lnr-novel-meta">Author: {novel.author}</Text>
              ) : null}
              {novel.artist && novel.artist !== novel.author ? (
                <Text className="lnr-novel-meta">Artist: {novel.artist}</Text>
              ) : null}
              <Text className="lnr-novel-meta">Source: {novel.pluginId}</Text>
            </Group>
          </div>
          <Button size="xs" variant="light" color="gray" onClick={onBack}>
            Back
          </Button>
        </div>

        <Group gap="xs" mt="sm" wrap="wrap">
          {novel.status ? (
            <ConsoleChip tone="accent">{novel.status}</ConsoleChip>
          ) : null}
          {novel.isLocal ? <ConsoleChip>local</ConsoleChip> : null}
          {novel.inLibrary ? (
            <ConsoleChip tone="success">in library</ConsoleChip>
          ) : (
            <ConsoleChip>not in library</ConsoleChip>
          )}
          {genres.slice(0, 5).map((genre) => (
            <ConsoleChip key={genre}>{genre}</ConsoleChip>
          ))}
        </Group>

        <div className="lnr-novel-progress-block">
          <div className="lnr-novel-progress-line">
            <ConsoleProgress
              value={readPercent}
              status={readPercent >= 100 ? "done" : "active"}
            />
            <span>{readPercent}% read</span>
          </div>
          <Group gap="md" mt={6} wrap="wrap">
            <Text className="lnr-novel-meta">
              Last read: {formatDate(novel.lastReadAt)}
            </Text>
            <Text className="lnr-novel-meta">
              Updated: {formatDate(novel.updatedAt)}
            </Text>
            <Text className="lnr-novel-meta">{unreadCount} unread</Text>
          </Group>
        </div>

        <Group gap="xs" mt="md" wrap="wrap">
          <Button
            size="sm"
            onClick={() => readableChapter && onRead(readableChapter.id)}
            disabled={!readableChapter}
          >
            {readLabel}
          </Button>
          <Button
            size="sm"
            onClick={onToggleLibrary}
            loading={toggleBusy}
            variant={novel.inLibrary ? "default" : "light"}
            color={novel.inLibrary ? "gray" : "blue"}
          >
            {novel.inLibrary ? "Remove from library" : "Add to library"}
          </Button>
          <Button
            size="sm"
            onClick={onOpenSource}
            disabled={!sourceUrl}
            variant="light"
            color="gray"
          >
            Open source
          </Button>
        </Group>
      </ConsolePanel>

      <ConsolePanel className="lnr-novel-summary-panel" title="Summary">
        {novel.summary ? (
          <Text className="lnr-novel-summary-text">{novel.summary}</Text>
        ) : (
          <Text className="lnr-novel-empty-copy">
            No summary indexed for this novel.
          </Text>
        )}
        {genres.length > 5 ? (
          <Group gap="xs" mt="sm" wrap="wrap">
            {genres.slice(5).map((genre) => (
              <ConsoleChip key={genre}>{genre}</ConsoleChip>
            ))}
          </Group>
        ) : null}
      </ConsolePanel>
    </div>
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
      <PageFrame>
        <StateView
          color="yellow"
          title="Missing id"
          message="The novel detail screen needs an id query parameter."
        />
      </PageFrame>
    );
  }

  if (novelQuery.isLoading) {
    return (
      <PageFrame>
        <StateView
          color="blue"
          title="Loading novel"
          message="Loading novel..."
        />
      </PageFrame>
    );
  }

  if (novelQuery.error) {
    return (
      <PageFrame>
        <StateView
          color="red"
          title="Failed to load novel"
          message={
            novelQuery.error instanceof Error
              ? novelQuery.error.message
              : String(novelQuery.error)
          }
        />
      </PageFrame>
    );
  }

  const novel = novelQuery.data;
  if (!novel) {
    return (
      <PageFrame>
        <StateView
          color="orange"
          title="Not found"
          message={`No novel matches id ${id}.`}
        />
      </PageFrame>
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
    <PageFrame className="lnr-novel-page" size="wide">
      <NovelWorkspace
        novel={novel}
        chapters={chapters}
        downloadedCount={downloadedCount}
        lastReadChapterId={lastReadChapterId}
        onBack={goBack}
        onRead={openChapter}
        onOpenSource={() => openSourceNovel(sourceUrl)}
        onToggleLibrary={() => toggle.mutate()}
        sourceUrl={sourceUrl}
        toggleBusy={toggle.isPending}
        unreadCount={unreadCount}
      />

      <ConsolePanel className="lnr-novel-chapters-panel">
        <ConsoleSectionHeader
          eyebrow="Chapter index"
          title="Chapters"
          count={`${chapters.length} total / ${downloadedCount} cached / ${unreadCount} unread`}
        />

        {chaptersQuery.isLoading ? (
          <StateView
            color="blue"
            title="Loading chapters"
            message="Loading chapters..."
          />
        ) : chapters.length === 0 ? (
          <StateView
            color="blue"
            title="No chapters"
            message="No chapters indexed yet for this novel."
          />
        ) : (
          <Stack gap={0} mt="sm">
            {chapters.map((chapter) => (
              <ChapterListItem
                key={chapter.id}
                chapter={chapter}
                isCurrent={chapter.id === lastReadChapterId}
                status={statuses.get(chapter.id)}
                onOpen={() => openChapter(chapter.id)}
                onDownload={() => downloadChapter(chapter)}
              />
            ))}
          </Stack>
        )}
      </ConsolePanel>
    </PageFrame>
  );
}
