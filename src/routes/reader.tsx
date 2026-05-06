import { useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Box } from "@mantine/core";
import { StateView } from "../components/AppFrame";
import {
  ReaderContent,
  type ReaderContentHandle,
} from "../components/ReaderContent";
import { BackIconButton } from "../components/BackIconButton";
import { IconButton } from "../components/IconButton";
import {
  getAdjacentChapter,
  getChapterById,
  listChaptersByNovel,
  markChapterOpened,
  setChapterBookmark,
  type ChapterRow,
  updateChapterProgress,
} from "../db/queries/chapter";
import { readerRoute } from "../router";
import { useLibraryStore } from "../store/library";
import { useReaderStore } from "../store/reader";
import { useTranslation, type TranslationKey } from "../i18n";
import "../styles/reader.css";

const FINISHED_PROGRESS = 100;

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

function getChapterLabel(
  chapter: Pick<ChapterRow, "chapterNumber" | "position">,
  t: (key: TranslationKey) => string,
) {
  const prefix = t("history.chapterPrefix");
  return chapter.chapterNumber
    ? `${prefix} ${chapter.chapterNumber}`
    : `${prefix} ${chapter.position}`;
}

function getReaderTitle(
  chapter: ChapterRow | null | undefined,
  t: (key: TranslationKey) => string,
): string {
  return chapter?.name ?? t("reader.title");
}

function getReaderMeta(
  chapter: ChapterRow | null | undefined,
  chapterIndex: number,
  chapterCount: number,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (!chapter) return t("reader.sampleContent");
  const indexLabel =
    chapterIndex >= 0 && chapterCount > 0
      ? `${chapterIndex + 1} / ${chapterCount}`
      : getChapterLabel(chapter, t);
  const status = chapter.isDownloaded
    ? t("reader.offline")
    : t("reader.notDownloaded");
  return [t("reader.novelMeta", { id: chapter.novelId }), indexLabel, status].join(" / ");
}

function ReaderTopChrome({
  chapter,
  chapterCount,
  chapterIndex,
  bookmarkDisabled,
  bookmarkLoading,
  incognitoMode,
  onBack,
  onOpenSettings,
  onToggleBookmark,
  progress,
}: {
  chapter: ChapterRow | null | undefined;
  chapterCount: number;
  chapterIndex: number;
  bookmarkDisabled: boolean;
  bookmarkLoading: boolean;
  incognitoMode: boolean;
  onBack: () => void;
  onOpenSettings: () => void;
  onToggleBookmark: () => void;
  progress: number;
}) {
  const { t } = useTranslation();

  return (
    <header className="lnr-reader-topbar">
      <BackIconButton
        className="lnr-reader-icon-button"
        label={t("reader.backToNovel")}
        onClick={onBack}
      />
      <div className="lnr-reader-topbar-title">
        <div className="lnr-reader-title" title={getReaderTitle(chapter, t)}>
          {getReaderTitle(chapter, t)}
        </div>
        <div className="lnr-reader-meta">
          {getReaderMeta(chapter, chapterIndex, chapterCount, t)}
        </div>
      </div>
      <div className="lnr-reader-topbar-spacer" />
      {incognitoMode ? (
        <span className="lnr-reader-status" data-status="muted">
          {t("reader.incognito")}
        </span>
      ) : null}
      <span className="lnr-reader-status">{Math.round(progress)}%</span>
      <IconButton
        active={Boolean(chapter?.bookmark)}
        className="lnr-reader-icon-button"
        disabled={bookmarkDisabled || bookmarkLoading}
        label={
          chapter?.bookmark
            ? t("reader.removeBookmark")
            : t("reader.bookmarkChapter")
        }
        onClick={onToggleBookmark}
        size="sm"
      >
        <BookmarkIcon />
      </IconButton>
      <IconButton
        className="lnr-reader-icon-button"
        label={t("reader.openSettings")}
        onClick={onOpenSettings}
        size="sm"
      >
        <SettingsIcon />
      </IconButton>
    </header>
  );
}

function BookmarkIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M6 4h12v16l-6-3.5L6 20V4z" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4 7h16" />
      <path d="M4 17h16" />
      <path d="M8 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
      <path d="M16 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
    </svg>
  );
}

function ReaderChapterPanel({
  chapters,
  currentChapterId,
  loading,
  onOpenChapter,
}: {
  chapters: ChapterRow[];
  currentChapterId: number | undefined;
  loading: boolean;
  onOpenChapter: (chapterId: number) => void;
}) {
  const { t } = useTranslation();

  return (
    <aside className="lnr-reader-chapter-panel" aria-label={t("reader.chapters")}>
      <div className="lnr-reader-panel-kicker">{t("reader.chapters")}</div>
      {loading ? (
        <div className="lnr-reader-panel-empty">{t("reader.loadingIndex")}</div>
      ) : chapters.length === 0 ? (
        <div className="lnr-reader-panel-empty">
          {t("reader.noIndexedChapters")}
        </div>
      ) : (
        <div className="lnr-reader-chapter-list">
          {chapters.map((item) => {
            const current = item.id === currentChapterId;
            const status =
              item.progress >= FINISHED_PROGRESS
                ? "done"
                : item.unread
                  ? "unread"
                  : "idle";
            return (
              <button
                aria-current={current ? "true" : undefined}
                className="lnr-reader-chapter-row"
                data-current={current}
                data-status={status}
                key={item.id}
                onClick={() => onOpenChapter(item.id)}
                title={item.name}
                type="button"
              >
                <span className="lnr-reader-chapter-number">
                  {getChapterLabel(item, t)}
                </span>
                <span className="lnr-reader-chapter-name">{item.name}</span>
                <span className="lnr-reader-chapter-dot" aria-hidden />
              </button>
            );
          })}
        </div>
      )}
    </aside>
  );
}

function ReaderBottomStrip({
  currentLabel,
  hasNextChapter,
  hasPreviousChapter,
  nextLabel,
  onNextChapter,
  onPreviousChapter,
  previousLabel,
  progress,
}: {
  currentLabel: string;
  hasNextChapter: boolean;
  hasPreviousChapter: boolean;
  nextLabel: string;
  onNextChapter: () => void;
  onPreviousChapter: () => void;
  previousLabel: string;
  progress: number;
}) {
  const { t } = useTranslation();
  const roundedProgress = Math.round(progress);

  return (
    <footer className="lnr-reader-bottom-strip">
      <button
        className="lnr-reader-strip-link"
        disabled={!hasPreviousChapter}
        onClick={onPreviousChapter}
        type="button"
      >
        {previousLabel}
      </button>
      <div className="lnr-reader-strip-progress">
        <div className="lnr-reader-strip-current">{currentLabel}</div>
        <div
          aria-label={t("reader.progressAria", { progress: roundedProgress })}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={roundedProgress}
          className="lnr-reader-progress-track"
          role="meter"
        >
          <span
            className="lnr-reader-progress-bar"
            style={{ width: `${roundedProgress}%` }}
          />
        </div>
      </div>
      <button
        className="lnr-reader-strip-link"
        disabled={!hasNextChapter}
        onClick={onNextChapter}
        type="button"
      >
        {nextLabel}
      </button>
    </footer>
  );
}

export function ReaderPage() {
  const { t } = useTranslation();
  const { chapterId } = readerRoute.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const contentRef = useRef<ReaderContentHandle | null>(null);
  const openedChapterRef = useRef<number | null>(null);

  const incognitoMode = useLibraryStore((state) => state.incognitoMode);
  const setLastReadChapter = useReaderStore(
    (state) => state.setLastReadChapter,
  );
  const setNovelPageIndex = useReaderStore((state) => state.setNovelPageIndex);

  const chapterQuery = useQuery({
    queryKey: chapterDetailKey(chapterId),
    queryFn: () => getChapterById(chapterId),
    enabled: chapterId > 0,
  });
  const currentNovelId = chapterQuery.data?.novelId ?? 0;
  const chapterListQuery = useQuery({
    queryKey: ["chapter", "list", currentNovelId],
    queryFn: () => listChaptersByNovel(currentNovelId),
    enabled: currentNovelId > 0,
  });

  const progressMutation = useMutation({
    mutationFn: (progress: number) =>
      updateChapterProgress(chapterId, progress, {
        recordHistory: !incognitoMode,
      }),
    onMutate: (progress) => {
      const applyProgress = (chapter: ChapterRow): ChapterRow => ({
        ...chapter,
        progress,
        unread: progress >= FINISHED_PROGRESS ? false : chapter.unread,
        readAt:
          incognitoMode || progress <= 0
            ? chapter.readAt
            : Math.floor(Date.now() / 1000),
      });
      queryClient.setQueryData<Awaited<ReturnType<typeof getChapterById>>>(
        chapterDetailKey(chapterId),
        (chapter) => (chapter ? applyProgress(chapter) : chapter),
      );
      if (currentNovelId > 0) {
        const updateChapterList = (chapters: ChapterRow[] | undefined) =>
          chapters?.map((chapter) =>
            chapter.id === chapterId ? applyProgress(chapter) : chapter,
          );
        queryClient.setQueryData<ChapterRow[]>(
          ["chapter", "list", currentNovelId],
          updateChapterList,
        );
        queryClient.setQueryData<ChapterRow[]>(
          ["novel", "detail", currentNovelId, "chapters"],
          updateChapterList,
        );
      }
    },
    onSuccess: (_result, progress) => {
      if (currentNovelId > 0) {
        void queryClient.invalidateQueries({
          queryKey: ["chapter", "list", currentNovelId],
        });
      }
      void queryClient.invalidateQueries({ queryKey: ["novel"] });
      if (!incognitoMode) {
        void queryClient.invalidateQueries({ queryKey: ["chapter", "history"] });
      }
      if (progress >= FINISHED_PROGRESS) {
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
        if (direction === 1) {
          contentRef.current?.completeIfAtEnd();
        }
        openedChapterRef.current = null;
        void navigate({ to: "/reader", search: { chapterId: adjacent.id } });
      }
    },
    [chapterQuery.data, navigate],
  );

  const openChapter = useCallback(
    (targetChapterId: number) => {
      if (targetChapterId === chapterId) return;
      openedChapterRef.current = null;
      void navigate({ to: "/reader", search: { chapterId: targetChapterId } });
    },
    [chapterId, navigate],
  );

  const handleReaderBack = useCallback(() => {
    const novelId = chapterQuery.data?.novelId;
    if (novelId) {
      void navigate({ to: "/novel", search: { id: novelId } });
      return;
    }
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    void navigate({ to: "/" });
  }, [chapterQuery.data?.novelId, navigate]);

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
          target.tagName === "BUTTON" ||
          target.tagName === "A" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      switch (event.key) {
        case "Escape":
          event.preventDefault();
          handleReaderBack();
          break;
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
  }, [handleReaderBack]);

  const chapter = chapterQuery.data;
  const chapters = chapterListQuery.data ?? [];
  const chapterIndex = chapter
    ? chapters.findIndex((item) => item.id === chapter.id)
    : -1;
  const previousChapter =
    chapterIndex > 0 ? chapters[chapterIndex - 1] : undefined;
  const nextChapter =
    chapterIndex >= 0 && chapterIndex < chapters.length - 1
      ? chapters[chapterIndex + 1]
      : undefined;
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

  const readerContent =
    chapterId > 0 && chapterQuery.isLoading ? (
      <Box className="lnr-reader-state-frame">
        <StateView
          color="blue"
          title={t("reader.loadingChapter")}
          message={t("reader.loadingContent")}
        />
      </Box>
    ) : chapterId > 0 && chapterQuery.error ? (
      <Box className="lnr-reader-state-frame">
        <StateView
          color="red"
          title={t("reader.loadFailed")}
          message={
            chapterQuery.error instanceof Error
              ? chapterQuery.error.message
              : String(chapterQuery.error)
          }
        />
      </Box>
    ) : chapterId > 0 && chapterQuery.data === null ? (
      <Box className="lnr-reader-state-frame">
        <StateView
          color="orange"
          title={t("reader.chapterNotFound")}
          message={t("reader.chapterNotFoundMessage", { id: chapterId })}
        />
      </Box>
    ) : chapterId > 0 && chapter && !chapter.isDownloaded ? (
      <Box className="lnr-reader-state-frame">
        <StateView
          color="blue"
          title={t("reader.notDownloadedYet")}
          message={t("reader.notDownloadedMessage")}
        />
      </Box>
    ) : (
      <ReaderContent
        key={chapter?.id ?? "sample"}
        ref={contentRef}
        bottomOverlayOffset={32}
        html={html}
        initialProgress={progress}
        onProgressChange={handleProgressChange}
        onPageIndexChange={handlePageIndexChange}
        onBoundaryPage={(direction) => {
          void openAdjacent(direction);
        }}
        viewportHeight="100%"
      />
    );

  return (
    <Box className="lnr-reader-shell">
      <ReaderTopChrome
        chapter={chapter}
        chapterCount={chapters.length}
        chapterIndex={chapterIndex}
        bookmarkDisabled={!chapter}
        bookmarkLoading={bookmarkMutation.isPending}
        incognitoMode={incognitoMode}
        onBack={handleReaderBack}
        onOpenSettings={() => {
          void navigate({ to: "/settings" });
        }}
        onToggleBookmark={() => bookmarkMutation.mutate()}
        progress={progress}
      />
      <Box className="lnr-reader-body">
        <ReaderChapterPanel
          chapters={chapters}
          currentChapterId={chapter?.id}
          loading={chapterListQuery.isLoading}
          onOpenChapter={openChapter}
        />
        <Box className="lnr-reader-content-frame">{readerContent}</Box>
      </Box>
      <ReaderBottomStrip
        currentLabel={chapter ? getChapterLabel(chapter, t) : t("reader.sample")}
        hasNextChapter={!!nextChapter}
        hasPreviousChapter={!!previousChapter}
        nextLabel={nextChapter ? getChapterLabel(nextChapter, t) : t("reader.next")}
        onNextChapter={() => {
          void openAdjacent(1);
        }}
        onPreviousChapter={() => {
          void openAdjacent(-1);
        }}
        previousLabel={
          previousChapter ? getChapterLabel(previousChapter, t) : t("common.previous")
        }
        progress={progress}
      />

    </Box>
  );
}
