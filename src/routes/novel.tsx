import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Group,
  Popover,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  DetailsGlyph,
  DownloadGlyph,
  DownloadedGlyph,
  LibraryAddGlyph,
  LibraryAddedGlyph,
  PlayFromStartGlyph,
  PlayGlyph,
} from "../components/ActionGlyphs";
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
import { IconButton } from "../components/IconButton";
import {
  clearChapterContent,
  listChaptersByNovel,
  type ChapterListRow,
} from "../db/queries/chapter";
import {
  getNovelById,
  setNovelInLibrary,
  type NovelDetailRecord,
} from "../db/queries/novel";
import {
  enqueueChapterDownload,
  enqueueChapterDownloadBatch,
  listChapterDownloadStatuses,
  subscribeChapterDownloads,
  type ChapterDownloadStatus,
} from "../lib/tasks/chapter-download";
import { markUpdatesIndexDirty } from "../lib/updates/update-index-events";
import { enqueueOpenSiteTask } from "../lib/tasks/source-tasks";
import { pluginManager } from "../lib/plugins/manager";
import { novelRoute } from "../router";
import { useTranslation } from "../i18n";
import { useLibraryStore } from "../store/library";
import { useReaderStore } from "../store/reader";
import "../styles/novel.css";

const FINISHED_PROGRESS = 100;
const CHAPTER_ROW_HEIGHT = 54;
const CHAPTER_LIST_OVERSCAN = 8;
const CHAPTER_LIST_VISIBLE_ROWS = 14;
const EMPTY_CHAPTERS: ChapterListRow[] = [];
const NOVEL_TITLE_FONT_SIZES = [
  "1.55rem",
  "1.42rem",
  "1.3rem",
  "1.18rem",
  "1.05rem",
] as const;

type NovelTitleFontSize = (typeof NOVEL_TITLE_FONT_SIZES)[number];

interface BatchDownloadTargets {
  all: ChapterListRow[];
  next10: ChapterListRow[];
  next30: ChapterListRow[];
  unread: ChapterListRow[];
}

interface BatchDownloadOption {
  chapters: ChapterListRow[];
  description: string;
  key: string;
  label: string;
}

function novelKey(id: number) {
  return ["novel", "detail", id] as const;
}

function chaptersKey(id: number) {
  return ["novel", "detail", id, "chapters"] as const;
}

function normalizeDateText(value: string): string {
  return value.replace(/,/g, "").replace(/\s+/g, " ").trim();
}

function formatChapterPosition(position: number): string {
  return `#${String(position).padStart(2, "0")}`;
}

function splitGenres(genres: string | null): string[] {
  if (!genres) return [];
  return genres
    .split(/[|,]/)
    .map((genre) => genre.trim())
    .filter(Boolean);
}

function isActiveDownloadStatus(
  status: ChapterDownloadStatus | undefined,
): boolean {
  return (
    status?.kind === "queued" ||
    status?.kind === "running" ||
    status?.kind === "done"
  );
}

function getReadingOrderChapters(
  chapters: readonly ChapterListRow[],
): readonly ChapterListRow[] {
  let asc = true;
  let desc = true;

  for (let index = 1; index < chapters.length; index += 1) {
    const previous = chapters[index - 1]!;
    const current = chapters[index]!;
    if (previous.position > current.position) asc = false;
    if (previous.position < current.position) desc = false;
  }

  if (asc) return chapters;
  if (desc) return [...chapters].reverse();
  return [...chapters].sort((left, right) => left.position - right.position);
}

function buildBatchDownloadTargets(
  chapters: readonly ChapterListRow[],
  lastReadChapterId: number | undefined,
  downloadStatuses: ReadonlyMap<number, ChapterDownloadStatus>,
): BatchDownloadTargets {
  const readingOrder = getReadingOrderChapters(chapters);
  const candidates = readingOrder.filter(
    (chapter) =>
      !chapter.isDownloaded &&
      !isActiveDownloadStatus(downloadStatuses.get(chapter.id)),
  );
  const currentIndex =
    lastReadChapterId === undefined
      ? -1
      : readingOrder.findIndex((chapter) => chapter.id === lastReadChapterId);
  const nextStartIndex = currentIndex >= 0 ? currentIndex + 1 : 0;
  const nextCandidates = readingOrder
    .slice(nextStartIndex)
    .filter(
      (chapter) =>
        !chapter.isDownloaded &&
        !isActiveDownloadStatus(downloadStatuses.get(chapter.id)),
    );

  return {
    all: candidates,
    next10: nextCandidates.slice(0, 10),
    next30: nextCandidates.slice(0, 30),
    unread: candidates.filter((chapter) => chapter.unread),
  };
}

function useAutoFitNovelTitle(title: string) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [fontSize, setFontSize] = useState<NovelTitleFontSize>(
    NOVEL_TITLE_FONT_SIZES[0],
  );

  useEffect(() => {
    const element = titleRef.current;
    if (!element || typeof window === "undefined") return;

    let frame = 0;

    const overflows = () =>
      element.scrollHeight > element.clientHeight + 1 ||
      element.scrollWidth > element.clientWidth + 1;

    const fitTitle = () => {
      let nextFontSize =
        NOVEL_TITLE_FONT_SIZES[NOVEL_TITLE_FONT_SIZES.length - 1];

      for (const size of NOVEL_TITLE_FONT_SIZES) {
        element.style.setProperty("--lnr-novel-title-font-size", size);
        if (!overflows()) {
          nextFontSize = size;
          break;
        }
      }

      element.style.setProperty(
        "--lnr-novel-title-font-size",
        nextFontSize,
      );
      setFontSize((currentFontSize) =>
        currentFontSize === nextFontSize ? currentFontSize : nextFontSize,
      );
    };

    const scheduleFit = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(fitTitle);
    };

    scheduleFit();

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(scheduleFit);

    resizeObserver?.observe(element);
    if (element.parentElement) resizeObserver?.observe(element.parentElement);
    window.addEventListener("resize", scheduleFit);

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleFit);
    };
  }, [title]);

  return {
    titleRef,
    titleStyle: {
      "--lnr-novel-title-font-size": fontSize,
    } as CSSProperties,
  };
}

function getChapterReadingProgress(chapter: ChapterListRow): number {
  if (chapter.progress >= FINISHED_PROGRESS) return 100;
  return Math.max(0, Math.min(100, Math.round(chapter.progress)));
}

function getNovelReadingPercent(chapters: readonly ChapterListRow[]): number {
  if (chapters.length === 0) return 0;
  const total = chapters.reduce(
    (sum, chapter) => sum + getChapterReadingProgress(chapter),
    0,
  );
  return Math.round(total / chapters.length);
}

function findFirstChapter(chapters: ChapterListRow[]): ChapterListRow | null {
  return chapters.reduce<ChapterListRow | null>((first, chapter) => {
    if (!first || chapter.position < first.position) return chapter;
    return first;
  }, null);
}

function findLastReadChapter(
  chapters: ChapterListRow[],
  lastReadChapterId: number | undefined,
): ChapterListRow | null {
  if (lastReadChapterId === undefined) return null;
  return chapters.find((chapter) => chapter.id === lastReadChapterId) ?? null;
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
  chapter: ChapterListRow;
  isCurrent: boolean;
  status: ChapterDownloadStatus | undefined;
  deleteBusy: boolean;
  opening: boolean;
  onOpen: () => void;
  onDownload: () => void;
  onDeleteDownload: () => void;
}

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
  const downloadActionLabel = failedMessage
    ? t("novel.retryDownload")
    : t("novel.downloadChapter");
  const showDownloadButton =
    !chapter.isDownloaded && !opening && !isQueued && !isRunning;
  const showOpeningSpinner =
    opening && !chapter.isDownloaded && !isQueued && !isRunning;
  const progress = getChapterReadingProgress(chapter);
  const progressStatus =
    progress >= FINISHED_PROGRESS
      ? "done"
      : chapter.progress > 0
        ? "active"
        : "idle";
  const releaseTime = chapter.releaseTime
    ? normalizeDateText(chapter.releaseTime)
    : null;
  const hasChapterFlags =
    chapter.bookmark ||
    !chapter.unread ||
    chapter.isDownloaded ||
    showOpeningSpinner ||
    Boolean(status);
  const renderChapterFlags = () => (
    <>
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
    </>
  );

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
        <span>{formatChapterPosition(chapter.position)}</span>
        {isCurrent ? (
          <ConsoleStatusDot status="active" label={t("common.current")} />
        ) : null}
      </div>

      <div className="lnr-novel-chapter-main">
        <div className="lnr-novel-chapter-title-line">
          <Text
            className="lnr-novel-chapter-title"
            data-read={!chapter.unread}
            title={chapter.name}
          >
            {chapter.name}
          </Text>
        </div>
        <div className="lnr-novel-chapter-meta-row">
          {releaseTime ? (
            <Text className="lnr-novel-chapter-meta">{releaseTime}</Text>
          ) : null}
          <span className="lnr-novel-chapter-percent lnr-novel-chapter-percent--inline">
            {progress}%
          </span>
          {hasChapterFlags ? (
            <span
              className="lnr-novel-chapter-flags lnr-novel-chapter-flags--inline"
              aria-label={t("novel.chapterStatus")}
            >
              {renderChapterFlags()}
            </span>
          ) : null}
        </div>
      </div>

      {hasChapterFlags ? (
        <div
          className="lnr-novel-chapter-flags lnr-novel-chapter-flags--desktop"
          aria-label={t("novel.chapterStatus")}
        >
          {renderChapterFlags()}
        </div>
      ) : null}

      <div className="lnr-novel-chapter-progress">
        <ConsoleProgress value={progress} status={progressStatus} />
        <span>{progress}%</span>
      </div>

      <div className="lnr-novel-chapter-actions">
        {showDownloadButton ? (
          <IconButton
            className="lnr-novel-icon-button"
            label={downloadActionLabel}
            size="lg"
            title={failedMessage ?? downloadActionLabel}
            tone={failedMessage ? "danger" : "default"}
            onClick={(event) => {
              event.stopPropagation();
              onDownload();
            }}
          >
            <DownloadGlyph />
          </IconButton>
        ) : null}
        {chapter.isDownloaded ? (
          <IconButton
            className="lnr-novel-icon-button"
            data-busy={deleteBusy ? "true" : undefined}
            disabled={deleteBusy}
            label={t("novel.deleteDownloadedChapter")}
            size="lg"
            onClick={(event) => {
              event.stopPropagation();
              onDeleteDownload();
            }}
          >
            <TrashIcon />
          </IconButton>
        ) : null}
      </div>
    </div>
  );
}

interface VirtualChapterListProps {
  chapters: ChapterListRow[];
  deleteBusyChapterId: number | undefined;
  deletePending: boolean;
  lastReadChapterId: number | undefined;
  openingChapterId: number | null;
  statuses: ReadonlyMap<number, ChapterDownloadStatus>;
  onDeleteDownload: (chapterId: number) => void;
  onDownload: (chapter: ChapterListRow) => void;
  onOpen: (chapter: ChapterListRow) => void;
}

function VirtualChapterList({
  chapters,
  deleteBusyChapterId,
  deletePending,
  lastReadChapterId,
  openingChapterId,
  statuses,
  onDeleteDownload,
  onDownload,
  onOpen,
}: VirtualChapterListProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(
    CHAPTER_ROW_HEIGHT * CHAPTER_LIST_VISIBLE_ROWS,
  );
  const totalHeight = chapters.length * CHAPTER_ROW_HEIGHT;
  const startIndex = Math.max(
    0,
    Math.floor(scrollTop / CHAPTER_ROW_HEIGHT) - CHAPTER_LIST_OVERSCAN,
  );
  const endIndex = Math.min(
    chapters.length,
    Math.ceil((scrollTop + viewportHeight) / CHAPTER_ROW_HEIGHT) +
      CHAPTER_LIST_OVERSCAN,
  );
  const visibleChapters = chapters.slice(startIndex, endIndex);
  const offsetY = startIndex * CHAPTER_ROW_HEIGHT;
  const listHeight = Math.min(chapters.length, CHAPTER_LIST_VISIBLE_ROWS) *
    CHAPTER_ROW_HEIGHT;

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;

    const updateViewportHeight = () => {
      setViewportHeight(element.clientHeight || CHAPTER_ROW_HEIGHT);
    };

    updateViewportHeight();

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateViewportHeight);

    resizeObserver?.observe(element);
    window.addEventListener("resize", updateViewportHeight);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateViewportHeight);
    };
  }, []);

  useEffect(() => {
    const maxScrollTop = Math.max(0, totalHeight - viewportHeight);
    setScrollTop((current) => Math.min(current, maxScrollTop));
  }, [totalHeight, viewportHeight]);

  return (
    <div
      className="lnr-novel-chapter-list"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      ref={viewportRef}
      style={
        {
          "--lnr-novel-chapter-list-height": `${listHeight}px`,
        } as CSSProperties
      }
    >
      <div
        className="lnr-novel-chapter-list-spacer"
        style={{ height: totalHeight }}
      >
        <div
          className="lnr-novel-chapter-list-window"
          style={{ transform: `translateY(${offsetY}px)` }}
        >
          {visibleChapters.map((chapter) => (
            <ChapterListItem
              key={chapter.id}
              chapter={chapter}
              isCurrent={chapter.id === lastReadChapterId}
              status={statuses.get(chapter.id)}
              deleteBusy={deletePending && deleteBusyChapterId === chapter.id}
              opening={openingChapterId === chapter.id}
              onOpen={() => onOpen(chapter)}
              onDownload={() => onDownload(chapter)}
              onDeleteDownload={() => onDeleteDownload(chapter.id)}
            />
          ))}
        </div>
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

function ChapterDownloadStatusIcon({
  status,
}: {
  status: ChapterDownloadStatus;
}) {
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
  active?: boolean;
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  pressed?: boolean;
  tone?: "default" | "accent" | "success";
}

interface NovelBatchDownloadMenuProps {
  disabled: boolean;
  onDownload: (chapters: ChapterListRow[]) => void;
  options: BatchDownloadOption[];
}

function NovelActionButton({
  active = false,
  children,
  disabled = false,
  label,
  onClick,
  pressed,
  tone = "default",
}: NovelActionButtonProps) {
  return (
    <IconButton
      active={active}
      aria-pressed={pressed}
      className="lnr-novel-icon-button"
      disabled={disabled}
      label={label}
      onClick={onClick}
      size="lg"
      tone={tone}
    >
      {children}
    </IconButton>
  );
}

function NovelBatchDownloadMenu({
  disabled,
  onDownload,
  options,
}: NovelBatchDownloadMenuProps) {
  const { t } = useTranslation();
  const [opened, setOpened] = useState(false);

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-end"
      shadow="md"
      width={260}
    >
      <Popover.Target>
        <IconButton
          className="lnr-novel-icon-button"
          disabled={disabled}
          label={t("novel.batchDownload.open")}
          onClick={() => setOpened((current) => !current)}
          size="lg"
        >
          <DownloadGlyph />
        </IconButton>
      </Popover.Target>
      <Popover.Dropdown className="lnr-novel-batch-download-menu">
        <div className="lnr-novel-batch-download-list">
          {options.map((option) => (
            <button
              className="lnr-novel-batch-download-option"
              disabled={option.chapters.length === 0}
              key={option.key}
              onClick={() => {
                onDownload(option.chapters);
                setOpened(false);
              }}
              type="button"
            >
              <span className="lnr-novel-batch-download-label">
                {option.label}
              </span>
              <span className="lnr-novel-batch-download-description">
                {option.description}
              </span>
            </button>
          ))}
        </div>
      </Popover.Dropdown>
    </Popover>
  );
}

interface NovelReadButtonProps {
  children: ReactNode;
  disabled: boolean;
  label: string;
  onClick: () => void;
  tone?: "default" | "accent";
}

function NovelReadButton({
  children,
  disabled,
  label,
  onClick,
  tone = "default",
}: NovelReadButtonProps) {
  return (
    <IconButton
      className="lnr-novel-read-icon-button"
      disabled={disabled}
      label={label}
      onClick={onClick}
      size="lg"
      tone={tone}
    >
      {children}
    </IconButton>
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
  chapters: ChapterListRow[];
  downloadStatuses: ReadonlyMap<number, ChapterDownloadStatus>;
  lastReadChapterId: number | undefined;
  novel: NovelDetailRecord;
  onBack: () => void;
  onBatchDownload: (chapters: ChapterListRow[]) => void;
  onOpenSource: () => void;
  onRead: (chapter: ChapterListRow) => void;
  onToggleLibrary: () => void;
  sourceUrl: string | null;
  toggleBusy: boolean;
}

function NovelWorkspace({
  chapters,
  downloadStatuses,
  lastReadChapterId,
  novel,
  onBack,
  onBatchDownload,
  onOpenSource,
  onRead,
  onToggleLibrary,
  sourceUrl,
  toggleBusy,
}: NovelWorkspaceProps) {
  const { t } = useTranslation();
  const { titleRef, titleStyle } = useAutoFitNovelTitle(novel.name);
  const genres = useMemo(() => splitGenres(novel.genres), [novel.genres]);
  const firstChapter = useMemo(() => findFirstChapter(chapters), [chapters]);
  const lastReadChapter = useMemo(
    () => findLastReadChapter(chapters, lastReadChapterId),
    [chapters, lastReadChapterId],
  );
  const readPercent = useMemo(() => getNovelReadingPercent(chapters), [chapters]);
  const libraryActionLabel = novel.inLibrary
    ? t("novel.removeFromLibrary")
    : t("novel.addToLibrary");
  const batchTargets = useMemo(
    () =>
      buildBatchDownloadTargets(
        chapters,
        lastReadChapterId,
        downloadStatuses,
      ),
    [chapters, downloadStatuses, lastReadChapterId],
  );
  const batchDownloadOptions: BatchDownloadOption[] = useMemo(
    () => [
      {
        chapters: batchTargets.all,
        description: t("novel.batchDownload.available", {
          count: batchTargets.all.length,
        }),
        key: "all",
        label: t("novel.batchDownload.all"),
      },
      {
        chapters: batchTargets.unread,
        description: t("novel.batchDownload.available", {
          count: batchTargets.unread.length,
        }),
        key: "unread",
        label: t("novel.batchDownload.unread"),
      },
      {
        chapters: batchTargets.next10,
        description: t("novel.batchDownload.available", {
          count: batchTargets.next10.length,
        }),
        key: "next10",
        label: t("novel.batchDownload.next10"),
      },
      {
        chapters: batchTargets.next30,
        description: t("novel.batchDownload.available", {
          count: batchTargets.next30.length,
        }),
        key: "next30",
        label: t("novel.batchDownload.next30"),
      },
    ],
    [batchTargets, t],
  );
  const hasBatchDownloadTargets = useMemo(
    () => batchDownloadOptions.some((option) => option.chapters.length > 0),
    [batchDownloadOptions],
  );
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

  const renderGenreTags = () =>
    genres.length > 0 ? (
      <div className="lnr-novel-tags-row" aria-label={t("library.tags.title")}>
        {genres.map((genre) => (
          <span className="lnr-novel-genre-chip" key={genre}>
            <ConsoleChip>{genre}</ConsoleChip>
          </span>
        ))}
      </div>
    ) : null;

  const renderInfoPanel = (isDesktop: boolean) => (
    <ConsolePanel className="lnr-novel-info-panel">
      <div className="lnr-novel-title-row">
        <BackIconButton className="lnr-novel-icon-button" onClick={onBack} />
        <div className="lnr-novel-title-copy">
          <Title
            className="lnr-novel-title"
            order={1}
            ref={isDesktop ? titleRef : undefined}
            style={isDesktop ? titleStyle : undefined}
          >
            {novel.name}
          </Title>
          <Group className="lnr-novel-meta-row" gap="xs" mt={6} wrap="wrap">
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
        <div className="lnr-novel-title-actions">
          <NovelBatchDownloadMenu
            disabled={!hasBatchDownloadTargets}
            onDownload={onBatchDownload}
            options={batchDownloadOptions}
          />
          <NovelActionButton
            active={novel.inLibrary}
            disabled={toggleBusy}
            label={libraryActionLabel}
            onClick={onToggleLibrary}
            pressed={novel.inLibrary}
            tone={novel.inLibrary ? "success" : "accent"}
          >
            {novel.inLibrary ? <LibraryAddedGlyph /> : <LibraryAddGlyph />}
          </NovelActionButton>
          <NovelActionButton
            disabled={!sourceUrl}
            label={t("novel.openSource")}
            onClick={onOpenSource}
          >
            <DetailsGlyph />
          </NovelActionButton>
        </div>
      </div>

      <div className="lnr-novel-status-block">
        <Group className="lnr-novel-identity-strip" gap="xs" wrap="wrap">
          {novel.status ? (
            <ConsoleChip tone="accent">{novel.status}</ConsoleChip>
          ) : null}
          {novel.isLocal ? <ConsoleChip>{t("common.local")}</ConsoleChip> : null}
        </Group>

        <div className="lnr-novel-progress-block">
          <div className="lnr-novel-progress-line">
            <ConsoleProgress
              value={readPercent}
              status={readPercent >= 100 ? "done" : "active"}
            />
            <span>{t("novel.percentRead", { progress: readPercent })}</span>
          </div>
          <div className="lnr-novel-read-actions">
            <NovelReadButton
              disabled={!lastReadChapter}
              label={t("novel.continueReading")}
              onClick={() => lastReadChapter && onRead(lastReadChapter)}
              tone="accent"
            >
              <PlayGlyph />
            </NovelReadButton>
            <NovelReadButton
              disabled={!firstChapter}
              label={t("novel.startReading")}
              onClick={() => firstChapter && onRead(firstChapter)}
            >
              <PlayFromStartGlyph />
            </NovelReadButton>
          </div>
        </div>
      </div>
    </ConsolePanel>
  );

  const renderSummaryPanel = () => (
    <ConsolePanel
      className="lnr-novel-summary-panel"
      title={t("common.summary")}
    >
      <div className="lnr-novel-summary-content">
        {novel.summary ? (
          <Text className="lnr-novel-summary-text">{novel.summary}</Text>
        ) : (
          <Text className="lnr-novel-empty-copy">{t("novel.noSummary")}</Text>
        )}
        {renderGenreTags()}
      </div>
    </ConsolePanel>
  );

  return (
    <div className="lnr-novel-workspace">
      <div className="lnr-novel-hero-desktop">
        {renderCoverPanel()}
        {renderInfoPanel(true)}
        {renderSummaryPanel()}
      </div>

      <div className="lnr-novel-hero-mobile">
        {renderInfoPanel(false)}
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
      markUpdatesIndexDirty("library-membership");
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
    ReadonlyMap<number, ChapterDownloadStatus>
  >(() => new Map());
  const [openingChapterId, setOpeningChapterId] = useState<number | null>(null);
  const openRequestRef = useRef(0);

  useEffect(() => {
    return subscribeChapterDownloads((event) => {
      if (event.job.novelId !== undefined && event.job.novelId !== id) return;
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

  const rows = chaptersQuery.data ?? EMPTY_CHAPTERS;
  const chapters = useMemo(
    () => (defaultChapterSort === "desc" ? [...rows].reverse() : rows),
    [defaultChapterSort, rows],
  );
  const chapterStats = useMemo(
    () => {
      let downloaded = 0;
      let unread = 0;
      for (const chapter of rows) {
        if (chapter.isDownloaded) downloaded += 1;
        if (chapter.unread) unread += 1;
      }
      return { downloaded, unread };
    },
    [rows],
  );

  useEffect(() => {
    if (rows.length === 0) return;
    const currentStatuses = listChapterDownloadStatuses();

    setStatuses((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const [chapterId, status] of currentStatuses) {
        if (status?.kind === "cancelled") {
          if (next.delete(chapterId)) changed = true;
          continue;
        }
        if (next.get(chapterId) !== status) {
          next.set(chapterId, status);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [rows]);

  function goBack() {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }

    void navigate({ to: "/" });
  }

  async function openChapter(chapter: ChapterListRow): Promise<void> {
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
      await enqueueChapterDownload({
        id: chapter.id,
        pluginId: novel.pluginId,
        chapterPath: chapter.path,
        chapterName: chapter.name,
        novelId: novel.id,
        novelName: novel.name,
        priority: "interactive",
        title: t("tasks.task.downloadChapter", { name: chapter.name }),
      }).promise;
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

  function openSourceNovel(pluginId: string, url: string | null) {
    if (!url) return;
    const plugin = pluginManager.getPlugin(pluginId);
    if (!plugin) return;
    void enqueueOpenSiteTask(
      plugin,
      url,
      t("tasks.task.openSite", { source: plugin.name }),
    ).promise.catch(() => undefined);
  }

  function downloadChapter(chapter: ChapterListRow): void {
    const novel = novelQuery.data;
    if (!novel) return;
    void enqueueChapterDownload({
      id: chapter.id,
      pluginId: novel.pluginId,
      chapterPath: chapter.path,
      chapterName: chapter.name,
      novelId: novel.id,
      novelName: novel.name,
      title: t("tasks.task.downloadChapter", { name: chapter.name }),
    }).promise.catch(() => undefined);
  }

  function downloadChapters(chaptersToDownload: ChapterListRow[]): void {
    const novel = novelQuery.data;
    if (!novel || chaptersToDownload.length === 0) return;

    void enqueueChapterDownloadBatch({
      jobs: chaptersToDownload.map((chapter) => ({
        id: chapter.id,
        pluginId: novel.pluginId,
        chapterPath: chapter.path,
        chapterName: chapter.name,
        novelId: novel.id,
        novelName: novel.name,
        title: t("tasks.task.downloadChapter", { name: chapter.name }),
      })),
      title: t("tasks.task.downloadChapterBatch", {
        count: chaptersToDownload.length,
      }),
    }).promise.catch(() => undefined);
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

  const sourceUrl = resolveNovelSourceUrl(novel);

  return (
    <PageFrame className="lnr-novel-page" size="wide">
      <NovelWorkspace
        novel={novel}
        chapters={chapters}
        downloadStatuses={statuses}
        lastReadChapterId={lastReadChapterId}
        onBack={goBack}
        onBatchDownload={downloadChapters}
        onRead={openChapter}
        onOpenSource={() => openSourceNovel(novel.pluginId, sourceUrl)}
        onToggleLibrary={() => toggle.mutate()}
        sourceUrl={sourceUrl}
        toggleBusy={toggle.isPending}
      />

      <ConsolePanel className="lnr-novel-chapters-panel">
        <ConsoleSectionHeader
          eyebrow={t("novel.chapterIndex")}
          title={t("novel.chapters")}
          count={t("novel.chapterCount", {
            total: chapters.length,
            cached: chapterStats.downloaded,
            unread: chapterStats.unread,
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
          <VirtualChapterList
            chapters={chapters}
            deleteBusyChapterId={clearDownload.variables}
            deletePending={clearDownload.isPending}
            lastReadChapterId={lastReadChapterId}
            openingChapterId={openingChapterId}
            statuses={statuses}
            onOpen={(chapter) => {
              void openChapter(chapter);
            }}
            onDownload={downloadChapter}
            onDeleteDownload={(chapterId) => clearDownload.mutate(chapterId)}
          />
        )}
      </ConsolePanel>
    </PageFrame>
  );
}
