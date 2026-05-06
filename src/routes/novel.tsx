import { type ReactNode, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Group,
  Stack,
  Text,
  Title,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { DownloadGlyph, DownloadedGlyph } from "../components/ActionGlyphs";
import {
  ConsoleChip,
  ConsoleCover,
  ConsolePanel,
  ConsoleProgress,
  ConsoleSectionHeader,
  ConsoleStatusDot,
} from "../components/ConsolePrimitives";
import { PageFrame, StateView } from "../components/AppFrame";
import { BackIconButton } from "../components/BackIconButton";
import {
  clearChapterContent,
  listChaptersByNovel,
  type ChapterRow,
} from "../db/queries/chapter";
import {
  getNovelById,
  setNovelInLibrary,
  type NovelDetailRecord,
} from "../db/queries/novel";
import { downloadQueue, type DownloadStatus } from "../lib/download/queue";
import { pluginManager } from "../lib/plugins/manager";
import { novelRoute } from "../router";
import {
  formatDateForLocale,
  useTranslation,
  type AppLocale,
} from "../i18n";
import { useLibraryStore } from "../store/library";
import { useReaderStore } from "../store/reader";
import { useSiteBrowserStore } from "../store/site-browser";
import "../styles/novel.css";

const FINISHED_PROGRESS = 100;

function novelKey(id: number) {
  return ["novel", "detail", id] as const;
}

function chaptersKey(id: number) {
  return ["novel", "detail", id, "chapters"] as const;
}

function formatDate(epoch: number | null, locale: AppLocale, t: TranslateFn): string {
  if (!epoch) return t("novel.never");
  return formatDateForLocale(locale, epoch * 1000);
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

interface ChapterListItemProps {
  chapter: ChapterRow;
  isCurrent: boolean;
  status: DownloadStatus | undefined;
  deleteBusy: boolean;
  opening: boolean;
  onOpen: () => void;
  onDownload: () => void;
  onDeleteDownload: () => void;
}

type TranslateFn = ReturnType<typeof useTranslation>["t"];

function ChapterListItem({
  chapter,
  isCurrent,
  status,
  deleteBusy,
  opening,
  onOpen,
  onDownload,
  onDeleteDownload,
}: ChapterListItemProps) {
  const { t } = useTranslation();
  const isQueued = status?.kind === "queued";
  const isRunning = status?.kind === "running";
  const failedMessage = status?.kind === "failed" ? status.error : null;
  const showDownloadButton =
    !chapter.isDownloaded && !opening && !isQueued && !isRunning;
  const showOpeningSpinner =
    opening && !chapter.isDownloaded && !isQueued && !isRunning;
  const progressStatus = chapterProgressStatus(chapter);

  return (
    <div
      className={`lnr-novel-chapter-row${
        isCurrent ? " lnr-novel-chapter-row--current" : ""
      }`}
      role="button"
      tabIndex={0}
      aria-busy={opening || isRunning}
      aria-label={t("novel.openChapter", { name: chapter.name })}
      data-opening={opening}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onOpen();
      }}
    >
      <div className="lnr-novel-chapter-position">
        <span>#{chapter.position}</span>
        {isCurrent ? (
          <ConsoleStatusDot status="active" label={t("common.current")} />
        ) : null}
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
              {t("history.chapterPrefix")} {chapter.chapterNumber}
            </Text>
          ) : null}
          {chapter.releaseTime ? (
            <Text className="lnr-novel-chapter-meta">
              {t("novel.released", { time: chapter.releaseTime })}
            </Text>
          ) : null}
        </Group>
      </div>

      <div className="lnr-novel-chapter-flags" aria-label={t("novel.chapterStatus")}>
        {chapter.bookmark ? (
          <ChapterFlag label={t("novel.bookmarked")} tone="warning">
            <BookmarkIcon />
          </ChapterFlag>
        ) : null}
        {!chapter.unread ? (
          <ChapterFlag label={t("common.read")} tone="done">
            <ReadIcon />
          </ChapterFlag>
        ) : null}
        {chapter.isDownloaded ? (
          <ChapterFlag label={t("novel.downloaded")} tone="done">
            <DownloadedGlyph />
          </ChapterFlag>
        ) : null}
        {showOpeningSpinner ? (
          <ChapterFlag label={t("common.downloading")}>
            <SpinnerIcon />
          </ChapterFlag>
        ) : null}
        {status ? <ChapterDownloadStatusIcon status={status} /> : null}
      </div>

      <div className="lnr-novel-chapter-progress">
        <ConsoleProgress value={chapter.progress} status={progressStatus} />
        <span>{Math.round(chapter.progress)}%</span>
      </div>

      <div className="lnr-novel-chapter-actions">
        {showDownloadButton ? (
          <Tooltip
            label={
              failedMessage ? t("novel.retryDownload") : t("novel.downloadChapter")
            }
            openDelay={350}
            withArrow
          >
            <UnstyledButton
              aria-label={
                failedMessage
                  ? t("novel.retryDownload")
                  : t("novel.downloadChapter")
              }
              className="lnr-novel-icon-button"
              data-tone={failedMessage ? "error" : undefined}
              title={failedMessage ?? t("novel.downloadChapter")}
              onClick={(event) => {
                event.stopPropagation();
                onDownload();
              }}
            >
              <DownloadGlyph />
            </UnstyledButton>
          </Tooltip>
        ) : null}
        {chapter.isDownloaded ? (
          <Tooltip
            label={t("novel.deleteDownloadedChapter")}
            openDelay={350}
            withArrow
          >
            <UnstyledButton
              aria-label={t("novel.deleteDownloadedChapter")}
              className="lnr-novel-icon-button"
              data-busy={deleteBusy}
              disabled={deleteBusy}
              title={t("novel.deleteDownloadedChapter")}
              onClick={(event) => {
                event.stopPropagation();
                onDeleteDownload();
              }}
            >
              <TrashIcon />
            </UnstyledButton>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}

interface ChapterFlagProps {
  children: ReactNode;
  label: string;
  tone?: "default" | "done" | "warning" | "error";
}

function ChapterFlag({
  children,
  label,
  tone = "default",
}: ChapterFlagProps) {
  return (
    <Tooltip label={label} openDelay={350} withArrow>
      <span
        aria-label={label}
        className="lnr-novel-chapter-flag"
        data-tone={tone}
        role="img"
        title={label}
      >
        {children}
      </span>
    </Tooltip>
  );
}

function ChapterDownloadStatusIcon({ status }: { status: DownloadStatus }) {
  const { t } = useTranslation();

  if (status.kind === "done" || status.kind === "cancelled") return null;

  if (status.kind === "failed") {
    return (
      <ChapterFlag label={status.error} tone="error">
        <AlertIcon />
      </ChapterFlag>
    );
  }

  if (status.kind === "running") {
    return (
      <ChapterFlag label={t("common.downloading")}>
        <SpinnerIcon />
      </ChapterFlag>
    );
  }

  return (
    <ChapterFlag label={t("common.queued")}>
      <ClockIcon />
    </ChapterFlag>
  );
}

interface NovelActionButtonProps {
  children: ReactNode;
  disabled?: boolean;
  label: string;
  loading?: boolean;
  onClick: () => void;
  tone?: "default" | "accent" | "danger";
}

function NovelActionButton({
  children,
  disabled = false,
  label,
  loading = false,
  onClick,
  tone = "default",
}: NovelActionButtonProps) {
  return (
    <Tooltip label={label} openDelay={350} withArrow>
      <UnstyledButton
        aria-label={label}
        className="lnr-novel-icon-button"
        data-busy={loading}
        data-tone={tone}
        disabled={disabled || loading}
        onClick={onClick}
        title={label}
      >
        {children}
      </UnstyledButton>
    </Tooltip>
  );
}

function ReadForwardIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M5 5h9a4 4 0 0 1 4 4v10H9a4 4 0 0 0-4 4z" />
      <path d="M9 9h5" />
      <path d="M9 13h4" />
    </svg>
  );
}

function LibraryAddIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" />
      <path d="M12 9v6" />
      <path d="M9 12h6" />
    </svg>
  );
}

function LibraryRemoveIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" />
      <path d="M9 12h6" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M14 4h6v6" />
      <path d="M20 4l-9 9" />
      <path d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5" />
    </svg>
  );
}

function BookmarkIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M7 4h10v16l-5-3-5 3z" />
    </svg>
  );
}

function ReadIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4 12l5 5L20 6" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M7 7l1 13h8l1-13" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 4l9 16H3z" />
      <path d="M12 9v5" />
      <path d="M12 18h.01" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg className="lnr-novel-spin-icon" aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 3a9 9 0 1 1-8.49 6" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v5l3 2" />
    </svg>
  );
}

interface NovelWorkspaceProps {
  chapters: ChapterRow[];
  lastReadChapterId: number | undefined;
  novel: NovelDetailRecord;
  onBack: () => void;
  onOpenSource: () => void;
  onRead: (chapter: ChapterRow) => void;
  onToggleLibrary: () => void;
  sourceUrl: string | null;
  toggleBusy: boolean;
  unreadCount: number;
}

function NovelWorkspace({
  chapters,
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
  const { locale, t } = useTranslation();
  const genres = splitGenres(novel.genres);
  const readableChapter = findReadableChapter(chapters, lastReadChapterId);
  const readPercent = getNovelReadingPercent(chapters);
  const readLabel =
    readPercent > 0 ? t("novel.continueReading") : t("novel.startReading");
  const libraryLabel = novel.inLibrary
    ? t("novel.removeFromLibrary")
    : t("novel.addToLibrary");
  const renderCoverPanel = () => (
    <ConsolePanel className="lnr-novel-cover-panel">
      <ConsoleCover
        alt={novel.name}
        height={204}
        src={novel.cover}
        width={136}
      />
    </ConsolePanel>
  );

  const renderInfoPanel = () => (
    <ConsolePanel className="lnr-novel-info-panel">
      <div className="lnr-novel-action-bar">
        <BackIconButton className="lnr-novel-icon-button" onClick={onBack} />
        <div className="lnr-novel-action-cluster">
          <NovelActionButton
            disabled={!readableChapter}
            label={readLabel}
            onClick={() => readableChapter && onRead(readableChapter)}
            tone="accent"
          >
            <ReadForwardIcon />
          </NovelActionButton>
          <NovelActionButton
            label={libraryLabel}
            loading={toggleBusy}
            onClick={onToggleLibrary}
            tone={novel.inLibrary ? "danger" : "accent"}
          >
            {novel.inLibrary ? <LibraryRemoveIcon /> : <LibraryAddIcon />}
          </NovelActionButton>
          <NovelActionButton
            disabled={!sourceUrl}
            label={t("novel.openSource")}
            onClick={onOpenSource}
          >
            <ExternalLinkIcon />
          </NovelActionButton>
        </div>
      </div>

      <Text className="lnr-console-kicker">/novel/{novel.id}</Text>
      <div className="lnr-novel-title-row">
        <div className="lnr-novel-title-copy">
          <Title className="lnr-novel-title" order={1}>
            {novel.name}
          </Title>
          <Group gap="xs" mt={6} wrap="wrap">
            {novel.author ? (
              <Text className="lnr-novel-meta">
                {t("novel.author", { name: novel.author })}
              </Text>
            ) : null}
            {novel.artist && novel.artist !== novel.author ? (
              <Text className="lnr-novel-meta">
                {t("novel.artist", { name: novel.artist })}
              </Text>
            ) : null}
            <Text className="lnr-novel-meta">
              {t("novel.source", { name: novel.pluginId })}
            </Text>
          </Group>
        </div>
      </div>

      <Group gap="xs" mt="sm" wrap="wrap">
        {novel.status ? (
          <ConsoleChip tone="accent">{novel.status}</ConsoleChip>
        ) : null}
        {novel.isLocal ? <ConsoleChip>{t("common.local")}</ConsoleChip> : null}
        {novel.inLibrary ? (
          <ConsoleChip tone="success">{t("novel.inLibrary")}</ConsoleChip>
        ) : (
          <ConsoleChip>{t("novel.notInLibrary")}</ConsoleChip>
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
          <span>{t("novel.percentRead", { progress: readPercent })}</span>
        </div>
        <Group gap="md" mt={6} wrap="wrap">
          <Text className="lnr-novel-meta">
            {t("novel.lastRead", {
              date: formatDate(novel.lastReadAt, locale, t),
            })}
          </Text>
          <Text className="lnr-novel-meta">
            {t("novel.updated", {
              date: formatDate(novel.updatedAt, locale, t),
            })}
          </Text>
          <Text className="lnr-novel-meta">
            {t("novel.unreadCount", { count: unreadCount })}
          </Text>
        </Group>
      </div>
    </ConsolePanel>
  );

  const renderSummaryPanel = () => (
    <ConsolePanel
      className="lnr-novel-summary-panel"
      title={t("common.summary")}
    >
      {novel.summary ? (
        <Text className="lnr-novel-summary-text">{novel.summary}</Text>
      ) : (
        <Text className="lnr-novel-empty-copy">{t("novel.noSummary")}</Text>
      )}
      {genres.length > 5 ? (
        <Group gap="xs" mt="sm" wrap="wrap">
          {genres.slice(5).map((genre) => (
            <ConsoleChip key={genre}>{genre}</ConsoleChip>
          ))}
        </Group>
      ) : null}
    </ConsolePanel>
  );

  return (
    <div className="lnr-novel-workspace">
      <div className="lnr-novel-hero-desktop">
        {renderCoverPanel()}
        {renderInfoPanel()}
        {renderSummaryPanel()}
      </div>

      <div className="lnr-novel-hero-mobile">
        {renderInfoPanel()}
        <div className="lnr-novel-cover-summary-card">
          {renderCoverPanel()}
          {renderSummaryPanel()}
        </div>
      </div>
    </div>
  );
}

export function NovelDetailPage() {
  const { t } = useTranslation();
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

  const clearDownload = useMutation({
    mutationFn: clearChapterContent,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: chaptersKey(id),
      });
      void queryClient.invalidateQueries({ queryKey: ["novel", "library"] });
    },
  });

  const [statuses, setStatuses] = useState<
    ReadonlyMap<number, DownloadStatus>
  >(() => new Map());
  const [openingChapterId, setOpeningChapterId] = useState<number | null>(null);
  const openRequestRef = useRef(0);

  useEffect(() => {
    return downloadQueue.subscribe((event) => {
      setStatuses((prev) => {
        const next = new Map(prev);
        if (event.status.kind === "cancelled") {
          next.delete(event.job.id);
        } else {
          next.set(event.job.id, event.status);
        }
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

  async function openChapter(chapter: ChapterRow): Promise<void> {
    const requestId = openRequestRef.current + 1;
    openRequestRef.current = requestId;

    if (chapter.isDownloaded) {
      void navigate({ to: "/reader", search: { chapterId: chapter.id } });
      return;
    }

    const novel = novelQuery.data;
    if (!novel) return;

    setOpeningChapterId(chapter.id);
    try {
      await downloadQueue.downloadNow({
        id: chapter.id,
        pluginId: novel.pluginId,
        chapterPath: chapter.path,
      });
      if (openRequestRef.current !== requestId) return;
      await queryClient.invalidateQueries({
        queryKey: chaptersKey(id),
      });
      void queryClient.invalidateQueries({ queryKey: ["novel", "library"] });
      void navigate({ to: "/reader", search: { chapterId: chapter.id } });
    } catch {
      // The queue emits the failed status; the row renders that state.
    } finally {
      if (openRequestRef.current === requestId) {
        setOpeningChapterId(null);
      }
    }
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
          title={t("novel.missingId")}
          message={t("novel.missingIdMessage")}
        />
      </PageFrame>
    );
  }

  if (novelQuery.isLoading) {
    return (
      <PageFrame>
        <StateView
          color="blue"
          title={t("novel.loading")}
          message={t("novel.loadingMessage")}
        />
      </PageFrame>
    );
  }

  if (novelQuery.error) {
    return (
      <PageFrame>
        <StateView
          color="red"
          title={t("novel.loadFailed")}
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
          title={t("novel.notFound")}
          message={t("novel.notFoundMessage", { id })}
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
          eyebrow={t("novel.chapterIndex")}
          title={t("novel.chapters")}
          count={t("novel.chapterCount", {
            total: chapters.length,
            cached: downloadedCount,
            unread: unreadCount,
          })}
        />

        {chaptersQuery.isLoading ? (
          <StateView
            color="blue"
            title={t("novel.loadingChapters")}
            message={t("novel.loadingChaptersMessage")}
          />
        ) : chapters.length === 0 ? (
          <StateView
            color="blue"
            title={t("novel.noChapters")}
            message={t("novel.noChaptersMessage")}
          />
        ) : (
          <Stack gap={0} mt="sm">
            {chapters.map((chapter) => (
              <ChapterListItem
                key={chapter.id}
                chapter={chapter}
                isCurrent={chapter.id === lastReadChapterId}
                status={statuses.get(chapter.id)}
                deleteBusy={
                  clearDownload.isPending &&
                  clearDownload.variables === chapter.id
                }
                opening={openingChapterId === chapter.id}
                onOpen={() => {
                  void openChapter(chapter);
                }}
                onDownload={() => downloadChapter(chapter)}
                onDeleteDownload={() =>
                  clearDownload.mutate(chapter.id)
                }
              />
            ))}
          </Stack>
        )}
      </ConsolePanel>
    </PageFrame>
  );
}
