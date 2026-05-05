import {
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { LibraryNovel } from "../db/queries/novel";
import type { LibraryDisplayMode } from "../store/library";
import {
  ConsoleChip,
  ConsoleCover,
  ConsoleProgress,
  ConsoleStatusDot,
} from "./ConsolePrimitives";

const LONG_PRESS_MS = 500;

interface LibraryGridProps {
  novels: readonly LibraryNovel[];
  displayMode: LibraryDisplayMode;
  novelsPerRow: number;
  showDownloadBadges: boolean;
  showUnreadBadges: boolean;
  showNumberBadges: boolean;
  selectedIds?: ReadonlySet<number>;
  onActivate?: (id: number) => void;
  onLongPress?: (id: number) => void;
}

export function LibraryGrid({
  novels,
  displayMode,
  novelsPerRow,
  showDownloadBadges,
  showUnreadBadges,
  showNumberBadges,
  selectedIds,
  onActivate,
  onLongPress,
}: LibraryGridProps) {
  return displayMode === "list" ? (
    <div className="lnr-library-table" role="table">
      <div className="lnr-library-table-header" role="row">
        <span />
        <span />
        <span>Title / Author</span>
        <span>Source</span>
        <span>Progress</span>
        <span>Unread</span>
        <span>Updated</span>
        <span />
      </div>
      {novels.map((novel, index) => (
        <LibraryTableRow
          key={novel.id}
          index={index}
          novel={novel}
          selected={selectedIds?.has(novel.id) ?? false}
          showNumberBadges={showNumberBadges}
          onActivate={onActivate}
          onLongPress={onLongPress}
        />
      ))}
    </div>
  ) : (
    <div className="lnr-library-grid-panel">
      <div
        className="lnr-library-grid"
        data-mode={displayMode}
        style={
          {
            "--lnr-library-grid-columns": novelsPerRow,
          } as CSSProperties
        }
      >
        {novels.map((novel, index) => (
          <LibraryCard
            key={novel.id}
            index={index}
            novel={novel}
            selected={selectedIds?.has(novel.id) ?? false}
            displayMode={displayMode}
            showDownloadBadges={showDownloadBadges}
            showNumberBadges={showNumberBadges}
            showUnreadBadges={showUnreadBadges}
            onActivate={onActivate}
            onLongPress={onLongPress}
          />
        ))}
      </div>
    </div>
  );
}

interface LibraryItemProps {
  children: ReactNode;
  className: string;
  novelId: number;
  onActivate?: (id: number) => void;
  onLongPress?: (id: number) => void;
  selected: boolean;
}

function LibraryInteractiveItem({
  children,
  className,
  novelId,
  onActivate,
  onLongPress,
  selected,
}: LibraryItemProps) {
  const longPressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);

  const cancelTimer = () => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handlePointerDown = () => {
    longPressed.current = false;
    if (!onLongPress) return;
    longPressTimer.current = window.setTimeout(() => {
      longPressed.current = true;
      onLongPress(novelId);
      longPressTimer.current = null;
    }, LONG_PRESS_MS);
  };

  const handlePointerUp = () => {
    cancelTimer();
    if (!longPressed.current) onActivate?.(novelId);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onActivate?.(novelId);
  };

  return (
    <div
      className={className}
      data-selected={selected}
      onKeyDown={handleKeyDown}
      onPointerCancel={cancelTimer}
      onPointerDown={handlePointerDown}
      onPointerLeave={cancelTimer}
      onPointerUp={handlePointerUp}
      role="button"
      tabIndex={0}
    >
      {children}
    </div>
  );
}

interface LibraryTableRowProps {
  index: number;
  novel: LibraryNovel;
  onActivate?: (id: number) => void;
  onLongPress?: (id: number) => void;
  selected: boolean;
  showNumberBadges: boolean;
}

interface LibraryNovelItemProps extends LibraryTableRowProps {
  displayMode?: LibraryDisplayMode;
  showDownloadBadges: boolean;
  showUnreadBadges: boolean;
}

function LibraryTableRow({
  index,
  novel,
  onActivate,
  onLongPress,
  selected,
  showNumberBadges,
}: LibraryTableRowProps) {
  const progress = getReadingPercent(novel);
  const downloadProgress = getDownloadPercent(novel);
  const status = getNovelStatus(novel);
  const hasUnread = novel.chaptersUnread > 0;

  return (
    <LibraryInteractiveItem
      className="lnr-library-table-row"
      novelId={novel.id}
      onActivate={onActivate}
      onLongPress={onLongPress}
      selected={selected}
    >
      <span className="lnr-library-row-marker">
        {showNumberBadges ? (
          index + 1
        ) : (
          <span data-active={hasUnread} />
        )}
      </span>
      <ConsoleCover alt={novel.name} height={42} src={novel.cover} width={28} />
      <span className="lnr-library-title-cell">
        <span className="lnr-library-title">{novel.name}</span>
        <span className="lnr-library-subtitle">
          {getCreatorLabel(novel)}
        </span>
      </span>
      <span className="lnr-library-source">{getSourceLabel(novel)}</span>
      <span className="lnr-library-progress-cell">
        <ConsoleProgress
          status={progress >= 100 ? "done" : "active"}
          value={progress}
        />
        <span className="lnr-library-percent">{progress}%</span>
      </span>
      <span className="lnr-library-unread" data-active={hasUnread}>
        {hasUnread ? `+${novel.chaptersUnread}` : "-"}
      </span>
      <span className="lnr-library-updated">
        {formatRelativeTime(novel.lastUpdatedAt)}
      </span>
      <span
        className="lnr-library-actions"
        data-downloaded={downloadProgress > 0}
        title={status.label}
      >
        <DownloadIcon />
      </span>
    </LibraryInteractiveItem>
  );
}

function LibraryCard({
  displayMode = "comfortable",
  index,
  novel,
  onActivate,
  onLongPress,
  selected,
  showDownloadBadges,
  showNumberBadges,
  showUnreadBadges,
}: LibraryNovelItemProps) {
  const downloadProgress = getDownloadPercent(novel);
  const readingProgress = getReadingPercent(novel);
  const status = getNovelStatus(novel);
  const coverOnly = displayMode === "cover-only";

  return (
    <LibraryInteractiveItem
      className="lnr-library-card"
      novelId={novel.id}
      onActivate={onActivate}
      onLongPress={onLongPress}
      selected={selected}
    >
      <div className="lnr-library-card-cover">
        {showNumberBadges ? (
          <span className="lnr-library-card-number">{index + 1}</span>
        ) : null}
        <ConsoleCover
          alt={novel.name}
          height={displayMode === "compact" ? 150 : 190}
          src={novel.cover}
          width={displayMode === "compact" ? 100 : 128}
        />
      </div>
      {coverOnly ? null : (
        <div className="lnr-library-card-body">
          <span className="lnr-library-title">{novel.name}</span>
          <span className="lnr-library-subtitle">{getCreatorLabel(novel)}</span>
          <div className="lnr-library-card-progress">
            <ConsoleProgress
              status={readingProgress >= 100 ? "done" : "active"}
              value={readingProgress}
            />
            <span className="lnr-library-percent">{readingProgress}%</span>
          </div>
          <div className="lnr-library-card-meta">
            <ConsoleStatusDot label={status.label} status={status.tone} />
            {showUnreadBadges && novel.chaptersUnread > 0 ? (
              <ConsoleChip tone="accent">{novel.chaptersUnread} unread</ConsoleChip>
            ) : null}
            {showDownloadBadges && novel.chaptersDownloaded > 0 ? (
              <ConsoleChip tone="success">{downloadProgress}% saved</ConsoleChip>
            ) : null}
          </div>
        </div>
      )}
    </LibraryInteractiveItem>
  );
}

function getDownloadPercent(novel: LibraryNovel) {
  if (novel.totalChapters <= 0) return 0;
  return Math.round((novel.chaptersDownloaded / novel.totalChapters) * 100);
}

function getReadingPercent(novel: LibraryNovel) {
  return Math.max(0, Math.min(100, Math.round(novel.readingProgress)));
}

function getSourceLabel(novel: LibraryNovel) {
  return novel.isLocal ? "Local" : novel.pluginId;
}

function getCreatorLabel(novel: LibraryNovel) {
  return novel.author?.trim() || getSourceLabel(novel);
}

function DownloadIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 4v11" />
      <path d="m8 11 4 4 4-4" />
      <path d="M5 20h14" />
    </svg>
  );
}

function formatRelativeTime(value: number | null) {
  if (value == null || value <= 0) return "never";
  const timestamp = value < 1_000_000_000_000 ? value * 1000 : value;
  const diffMs = Date.now() - timestamp;
  if (diffMs < 60_000) return "now";

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;

  return new Date(timestamp).toLocaleDateString();
}

function getNovelStatus(novel: LibraryNovel): {
  label: string;
  tone: "active" | "done" | "idle";
} {
  if (novel.chaptersUnread > 0) {
    return { label: "Unread", tone: "active" };
  }
  if (novel.totalChapters > 0 && novel.chaptersDownloaded >= novel.totalChapters) {
    return { label: "Saved", tone: "done" };
  }
  return { label: "Synced", tone: "idle" };
}
