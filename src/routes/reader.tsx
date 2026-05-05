import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Box } from "@mantine/core";
import { StateView } from "../components/AppFrame";
import {
  ReaderContent,
  type ReaderContentHandle,
} from "../components/ReaderContent";
import { ReaderQuickMenu } from "../components/ReaderQuickMenu";
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

function getChapterLabel(chapter: Pick<ChapterRow, "chapterNumber" | "position">) {
  return chapter.chapterNumber ? `Ch. ${chapter.chapterNumber}` : `Ch. ${chapter.position}`;
}

function getReaderTitle(chapter: ChapterRow | null | undefined): string {
  return chapter?.name ?? "Reader";
}

function getReaderMeta(
  chapter: ChapterRow | null | undefined,
  chapterIndex: number,
  chapterCount: number,
): string {
  if (!chapter) return "Sample content";
  const indexLabel =
    chapterIndex >= 0 && chapterCount > 0
      ? `${chapterIndex + 1} / ${chapterCount}`
      : getChapterLabel(chapter);
  const status = chapter.isDownloaded ? "Offline" : "Not downloaded";
  return [`Novel ${chapter.novelId}`, indexLabel, status].join(" / ");
}

function ReaderTopChrome({
  chapter,
  chapterCount,
  chapterIndex,
  incognitoMode,
  onBack,
  onToggleMenu,
  progress,
}: {
  chapter: ChapterRow | null | undefined;
  chapterCount: number;
  chapterIndex: number;
  incognitoMode: boolean;
  onBack: () => void;
  onToggleMenu: () => void;
  progress: number;
}) {
  return (
    <header className="lnr-reader-topbar">
      <button
        aria-label="Back to novel"
        className="lnr-reader-icon-button"
        onClick={onBack}
        type="button"
      >
        Back
      </button>
      <div className="lnr-reader-topbar-title">
        <div className="lnr-reader-title" title={getReaderTitle(chapter)}>
          {getReaderTitle(chapter)}
        </div>
        <div className="lnr-reader-meta">
          {getReaderMeta(chapter, chapterIndex, chapterCount)}
        </div>
      </div>
      <div className="lnr-reader-topbar-spacer" />
      {incognitoMode ? (
        <span className="lnr-reader-status" data-status="muted">
          Incognito
        </span>
      ) : null}
      <span className="lnr-reader-status">{Math.round(progress)}%</span>
      <button
        aria-label="Open reader menu"
        className="lnr-reader-icon-button"
        onClick={onToggleMenu}
        type="button"
      >
        Menu
      </button>
    </header>
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
  return (
    <aside className="lnr-reader-chapter-panel" aria-label="Chapters">
      <div className="lnr-reader-panel-kicker">Chapters</div>
      {loading ? (
        <div className="lnr-reader-panel-empty">Loading index...</div>
      ) : chapters.length === 0 ? (
        <div className="lnr-reader-panel-empty">No indexed chapters.</div>
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
                  {getChapterLabel(item)}
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
          aria-label={`${roundedProgress}% progress`}
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
  const { chapterId } = readerRoute.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const contentRef = useRef<ReaderContentHandle | null>(null);
  const openedChapterRef = useRef<number | null>(null);
  const [menuVisible, setMenuVisible] = useState(false);

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
        setMenuVisible(false);
        openedChapterRef.current = null;
        void navigate({ to: "/reader", search: { chapterId: adjacent.id } });
      }
    },
    [chapterQuery.data, navigate],
  );

  const openChapter = useCallback(
    (targetChapterId: number) => {
      if (targetChapterId === chapterId) return;
      setMenuVisible(false);
      openedChapterRef.current = null;
      void navigate({ to: "/reader", search: { chapterId: targetChapterId } });
    },
    [chapterId, navigate],
  );

  const handleReaderBack = useCallback(() => {
    const novelId = chapterQuery.data?.novelId;
    setMenuVisible(false);
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
      if (menuVisible && event.key !== "Escape") {
        return;
      }
      switch (event.key) {
        case "Escape":
          event.preventDefault();
          if (menuVisible) {
            setMenuVisible(false);
          } else {
            handleReaderBack();
          }
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
  }, [handleReaderBack, menuVisible]);

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
          title="Loading chapter"
          message="Loading reader content..."
        />
      </Box>
    ) : chapterId > 0 && chapterQuery.error ? (
      <Box className="lnr-reader-state-frame">
        <StateView
          color="red"
          title="Failed to load chapter"
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
          title="Chapter not found"
          message={`No chapter row with id ${chapterId} exists in the local DB.`}
        />
      </Box>
    ) : chapterId > 0 && chapter && !chapter.isDownloaded ? (
      <Box className="lnr-reader-state-frame">
        <StateView
          color="blue"
          title="Not downloaded yet"
          message={
            "Open this chapter from the novel detail screen and tap " +
            "\"Download\" to fetch its body before reading offline."
          }
        />
      </Box>
    ) : (
      <ReaderContent
        key={chapter?.id ?? "sample"}
        ref={contentRef}
        bottomOverlayOffset={32}
        html={html}
        initialProgress={progress}
        interactionBlocked={menuVisible}
        onProgressChange={handleProgressChange}
        onPageIndexChange={handlePageIndexChange}
        onToggleChrome={() => setMenuVisible((visible) => !visible)}
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
        incognitoMode={incognitoMode}
        onBack={handleReaderBack}
        onToggleMenu={() => setMenuVisible((visible) => !visible)}
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
        currentLabel={chapter ? getChapterLabel(chapter) : "Sample"}
        hasNextChapter={!!nextChapter}
        hasPreviousChapter={!!previousChapter}
        nextLabel={nextChapter ? getChapterLabel(nextChapter) : "Next"}
        onNextChapter={() => {
          void openAdjacent(1);
        }}
        onPreviousChapter={() => {
          void openAdjacent(-1);
        }}
        previousLabel={
          previousChapter ? getChapterLabel(previousChapter) : "Previous"
        }
        progress={progress}
      />

      <ReaderQuickMenu
        visible={menuVisible}
        chapterName={chapter?.name}
        progress={progress}
        incognitoMode={incognitoMode}
        bookmarked={chapter?.bookmark ?? false}
        bookmarkLoading={bookmarkMutation.isPending}
        bookmarkDisabled={!chapter}
        hasNextChapter={!!nextChapter}
        hasPreviousChapter={!!previousChapter}
        onBookmark={() => bookmarkMutation.mutate()}
        onBack={handleReaderBack}
        onClose={() => setMenuVisible(false)}
        onOpenSettings={() => {
          setMenuVisible(false);
          void navigate({ to: "/settings" });
        }}
        onPreviousChapter={() => {
          void openAdjacent(-1);
        }}
        onNextChapter={() => {
          void openAdjacent(1);
        }}
        onScrollToStart={() => {
          contentRef.current?.scrollToStart();
        }}
      />
    </Box>
  );
}
