import { useMemo, useState, type ReactNode } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Box,
  Button,
  Group,
  Image,
  Loader,
  Paper,
  SegmentedControl,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import {
  PageFrame,
  PageHeader,
  StateView,
} from "../components/AppFrame";
import {
  clearNovelHistory,
  getAdjacentChapter,
  listRecentlyRead,
  type RecentlyReadEntry,
} from "../db/queries/chapter";

const HISTORY_LIMIT = 100;
const FINISHED_PROGRESS = 100;

type ProgressFilter = "all" | "inProgress" | "finished";
type DateBucket = "Today" | "This week" | "Older";

interface HistoryDateSection {
  label: DateBucket;
  entries: RecentlyReadEntry[];
}

const DATE_BUCKETS: DateBucket[] = ["Today", "This week", "Older"];

function formatClock(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatHistoryTimestamp(epochSeconds: number): string {
  const now = new Date();
  const date = new Date(epochSeconds * 1000);
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const dateStart = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
  const dayDelta = Math.floor(
    (todayStart - dateStart) / (24 * 60 * 60 * 1000),
  );

  if (dayDelta === 0) return `Today - ${formatClock(date)}`;
  if (dayDelta === 1) return `Yesterday - ${formatClock(date)}`;
  if (dayDelta < 7) {
    return `${new Intl.DateTimeFormat(undefined, {
      weekday: "short",
    }).format(date)} - ${formatClock(date)}`;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatDateBucket(epochSeconds: number): DateBucket {
  const now = new Date();
  const date = new Date(epochSeconds * 1000);
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const dateStart = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();

  if (dateStart === todayStart) return "Today";
  if (todayStart - dateStart < 7 * 24 * 60 * 60 * 1000) {
    return "This week";
  }
  return "Older";
}

function getProgressStatus(entry: RecentlyReadEntry): "finished" | "active" {
  return entry.progress >= FINISHED_PROGRESS ? "finished" : "active";
}

function matchesProgressFilter(
  entry: RecentlyReadEntry,
  filter: ProgressFilter,
): boolean {
  if (filter === "finished") return entry.progress >= FINISHED_PROGRESS;
  if (filter === "inProgress") return entry.progress < FINISHED_PROGRESS;
  return true;
}

function matchesSearch(entry: RecentlyReadEntry, search: string): boolean {
  const normalized = search.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return (
    entry.novelName.toLocaleLowerCase().includes(normalized) ||
    entry.chapterName.toLocaleLowerCase().includes(normalized) ||
    String(entry.position).includes(normalized)
  );
}

function groupByDateBucket(
  entries: readonly RecentlyReadEntry[],
): HistoryDateSection[] {
  return DATE_BUCKETS.map((label) => ({
    label,
    entries: entries.filter(
      (entry) => formatDateBucket(entry.readAt) === label,
    ),
  })).filter((section) => section.entries.length > 0);
}

function HistoryCover({
  entry,
  size = "row",
}: {
  entry: RecentlyReadEntry;
  size?: "resume" | "row" | "dense";
}) {
  const dimensions =
    size === "resume"
      ? { w: 88, h: 130 }
      : size === "dense"
        ? { w: 44, h: 66 }
        : { w: 46, h: 68 };

  if (entry.novelCover) {
    return (
      <Image
        src={entry.novelCover}
        fallbackSrc={undefined}
        w={dimensions.w}
        h={dimensions.h}
        alt={entry.novelName}
        radius={3}
      />
    );
  }

  return (
    <Box
      aria-label={`${entry.novelName} cover placeholder`}
      className="lnr-history-cover-placeholder"
      style={dimensions}
    >
      <span>{entry.novelName.slice(0, 28)}</span>
    </Box>
  );
}

function HistoryProgress({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const status = clamped >= FINISHED_PROGRESS ? "finished" : "active";

  return (
    <div
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={clamped}
      className="lnr-history-progress"
      role="progressbar"
    >
      <div
        className="lnr-history-progress-bar"
        data-status={status}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

function StatusDot({ entry }: { entry: RecentlyReadEntry }) {
  const status = getProgressStatus(entry);
  const label = status === "finished" ? "Finished" : "In progress";

  return (
    <span
      aria-label={label}
      className="lnr-history-status"
      data-status={status}
    >
      <span aria-hidden className="lnr-history-status-dot" />
      {label}
    </span>
  );
}

function HistoryChip({
  active,
  children,
}: {
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <span className="lnr-history-chip" data-active={active ? "true" : "false"}>
      {children}
    </span>
  );
}

interface HistoryRowProps {
  entry: RecentlyReadEntry;
  removingNovelId: number | null;
  onContinueReading: () => void;
  onOpenNovel: () => void;
  onRemoveNovel: () => void;
}

function HistoryRow({
  entry,
  removingNovelId,
  onContinueReading,
  onOpenNovel,
  onRemoveNovel,
}: HistoryRowProps) {
  const removing = removingNovelId === entry.novelId;

  return (
    <Paper
      aria-label={`${entry.novelName}, ${entry.progress}% progress, last read chapter ${entry.position}`}
      className="lnr-history-row"
      component="article"
      data-removing={removing ? "true" : "false"}
      onClick={onOpenNovel}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenNovel();
        }
      }}
      role="button"
      tabIndex={0}
      withBorder
    >
      <HistoryCover entry={entry} />
      <Box className="lnr-history-row-main">
        <Group gap="xs" mb={2} wrap="nowrap">
          <Text
            className="lnr-history-row-title"
            component="span"
            lineClamp={1}
            title={entry.novelName}
          >
            {entry.novelName}
          </Text>
          <StatusDot entry={entry} />
        </Group>
        <Text
          className="lnr-history-row-chapter"
          component="div"
          lineClamp={1}
          title={entry.chapterName}
        >
          <span>Ch.{entry.position}</span> - <em>{entry.chapterName}</em>
        </Text>
        <Group className="lnr-history-row-meta" gap="xs" wrap="nowrap">
          <Box className="lnr-history-row-progress">
            <HistoryProgress value={entry.progress} />
          </Box>
          <Text component="span">
            {entry.progress}% - {formatHistoryTimestamp(entry.readAt)}
          </Text>
        </Group>
      </Box>
      <Group
        className="lnr-history-row-actions"
        gap={6}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        wrap="nowrap"
      >
        {removing ? (
          <span className="lnr-history-removing">
            <Loader size={10} />
            removing
          </span>
        ) : (
          <>
            <Button
              aria-label={`Continue reading ${entry.novelName}`}
              className="lnr-history-button lnr-history-button--primary"
              onClick={onContinueReading}
              size="xs"
              variant="default"
            >
              Continue
            </Button>
            <Button
              aria-label={`Open details for ${entry.novelName}`}
              className="lnr-history-button"
              onClick={onOpenNovel}
              size="xs"
              variant="default"
            >
              Details
            </Button>
            <Button
              aria-label={`Remove ${entry.novelName} from history`}
              className="lnr-history-button lnr-history-button--danger"
              onClick={onRemoveNovel}
              size="xs"
              variant="default"
            >
              Remove
            </Button>
          </>
        )}
      </Group>
    </Paper>
  );
}

interface ResumePanelProps {
  checkingNextChapter: boolean;
  entry: RecentlyReadEntry;
  nextChapterName: string | null;
  nextChapterPosition: number | null;
  onContinueReading: () => void;
  onOpenNovel: () => void;
}

function ResumePanel({
  checkingNextChapter,
  entry,
  nextChapterName,
  nextChapterPosition,
  onContinueReading,
  onOpenNovel,
}: ResumePanelProps) {
  const nextLabel =
    entry.progress < FINISHED_PROGRESS
      ? `Current - Ch.${entry.position} ${entry.chapterName}`
      : checkingNextChapter
        ? "Checking next chapter..."
        : nextChapterName
          ? `Next - Ch.${nextChapterPosition} ${nextChapterName}`
          : "Next chapter is not indexed.";

  return (
    <Paper className="lnr-history-resume" withBorder>
      <HistoryCover entry={entry} size="resume" />
      <Box className="lnr-history-resume-main">
        <Text className="lnr-history-kicker">Resume</Text>
        <Title className="lnr-history-resume-title" order={2} lineClamp={1}>
          {entry.novelName}
        </Title>
        <Text className="lnr-history-resume-last" lineClamp={1}>
          Last read - <span>Ch.{entry.position}</span>{" "}
          <em>{entry.chapterName}</em>
        </Text>
        <Group gap="xs" mt={8} wrap="nowrap">
          <Box style={{ flex: 1 }}>
            <HistoryProgress value={entry.progress} />
          </Box>
          <Text className="lnr-history-percent">{entry.progress}%</Text>
        </Group>
        <Text className="lnr-history-next" lineClamp={1}>
          {nextLabel}
        </Text>
        <Group gap="xs" mt="auto">
          <Button
            className="lnr-history-button lnr-history-button--primary"
            onClick={onContinueReading}
            size="xs"
            variant="default"
          >
            Continue
          </Button>
          <Button
            className="lnr-history-button"
            onClick={onOpenNovel}
            size="xs"
            variant="default"
          >
            Details
          </Button>
        </Group>
      </Box>
    </Paper>
  );
}

function HistorySummaryPanel({
  entries,
  sections,
}: {
  entries: RecentlyReadEntry[];
  sections: HistoryDateSection[];
}) {
  const thisWeekCount = entries.filter(
    (entry) => formatDateBucket(entry.readAt) !== "Older",
  ).length;
  const finishedCount = entries.filter(
    (entry) => entry.progress >= FINISHED_PROGRESS,
  ).length;
  const averageProgress =
    entries.length === 0
      ? 0
      : Math.round(
          entries.reduce((sum, entry) => sum + entry.progress, 0) /
            entries.length,
        );
  const countFor = (label: DateBucket) =>
    sections.find((section) => section.label === label)?.entries.length ?? 0;

  return (
    <Paper className="lnr-history-summary" withBorder>
      <Box>
        <Text className="lnr-history-kicker">This week</Text>
        <Title className="lnr-history-summary-title" order={2}>
          {thisWeekCount} novel{thisWeekCount === 1 ? "" : "s"} -{" "}
          {finishedCount} finished
        </Title>
        <Text className="lnr-history-summary-copy">
          Average progress {averageProgress}% across the visible history.
        </Text>
      </Box>
      <Group gap="xs" wrap="wrap">
        <HistoryChip active>
          Today - {countFor("Today")}
        </HistoryChip>
        <HistoryChip>This week - {countFor("This week")}</HistoryChip>
        <HistoryChip>Older - {countFor("Older")}</HistoryChip>
      </Group>
    </Paper>
  );
}

function FilterBar({
  progressFilter,
  search,
  onProgressFilterChange,
  onSearchChange,
}: {
  progressFilter: ProgressFilter;
  search: string;
  onProgressFilterChange: (filter: ProgressFilter) => void;
  onSearchChange: (search: string) => void;
}) {
  return (
    <Group className="lnr-history-filter" gap="xs" wrap="wrap">
      <TextInput
        aria-label="Search history by novel name, chapter title, or chapter number"
        className="lnr-history-search"
        placeholder="Search by novel - chapter - #"
        value={search}
        onChange={(event) => onSearchChange(event.currentTarget.value)}
      />
      <SegmentedControl
        className="lnr-history-segments"
        data={[
          { value: "all", label: "All" },
          { value: "inProgress", label: "In progress" },
          { value: "finished", label: "Finished" },
        ]}
        onChange={(value) => onProgressFilterChange(value as ProgressFilter)}
        value={progressFilter}
      />
    </Group>
  );
}

function HistorySection({
  children,
  count,
  title,
}: {
  children: ReactNode;
  count: number;
  title: DateBucket;
}) {
  return (
    <section className="lnr-history-section">
      <Group align="baseline" gap="xs" mb={8}>
        <Title className="lnr-history-section-title" order={3}>
          {title}
        </Title>
        <Text className="lnr-history-section-count">- {count}</Text>
      </Group>
      <Stack gap={6}>{children}</Stack>
    </section>
  );
}

function HistoryLoadingState() {
  return (
    <Stack className="lnr-history-loading" gap={6}>
      {[0, 1, 2].map((item) => (
        <Paper className="lnr-history-row" key={item} withBorder>
          <Skeleton height={68} radius={3} width={46} />
          <Box style={{ flex: 1 }}>
            <Skeleton height={12} radius={3} width="40%" />
            <Skeleton height={10} mt={8} radius={3} width="70%" />
            <Skeleton height={4} mt={12} radius={2} width="50%" />
          </Box>
        </Paper>
      ))}
      <Text className="lnr-history-loading-label">Loading reading history...</Text>
    </Stack>
  );
}

function HistoryEmptyState({
  hasSearch,
  onOpenLibrary,
}: {
  hasSearch: boolean;
  onOpenLibrary: () => void;
}) {
  return (
    <Paper className="lnr-history-empty" withBorder>
      <Title order={3}>{hasSearch ? "No matches" : "No reading history yet"}</Title>
      <Text>
        {hasSearch
          ? "Try a different novel name, chapter title, or chapter number."
          : "When you start reading from your Library, the latest read entry per novel will appear here."}
      </Text>
      {!hasSearch ? (
        <Button
          className="lnr-history-button lnr-history-button--primary"
          mt="md"
          onClick={onOpenLibrary}
          size="xs"
          variant="default"
        >
          Open Library
        </Button>
      ) : null}
    </Paper>
  );
}

export function HistoryPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [progressFilter, setProgressFilter] =
    useState<ProgressFilter>("all");

  const query = useQuery({
    queryKey: ["chapter", "history", HISTORY_LIMIT] as const,
    queryFn: () => listRecentlyRead(HISTORY_LIMIT),
  });
  const latestEntry = query.data?.[0] ?? null;
  const nextChapterQuery = useQuery({
    queryKey: [
      "chapter",
      "history",
      "next",
      latestEntry?.chapterId ?? 0,
    ] as const,
    queryFn: () => {
      if (!latestEntry) return null;
      return getAdjacentChapter(latestEntry.novelId, latestEntry.position, 1);
    },
    enabled: !!latestEntry && latestEntry.progress >= FINISHED_PROGRESS,
  });
  const removeHistory = useMutation({
    mutationFn: clearNovelHistory,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["chapter", "history"] });
      void queryClient.invalidateQueries({ queryKey: ["novel"] });
    },
  });

  const visibleEntries = useMemo(
    () =>
      (query.data ?? []).filter(
        (entry) =>
          matchesSearch(entry, search) &&
          matchesProgressFilter(entry, progressFilter),
      ),
    [progressFilter, query.data, search],
  );
  const sections = useMemo(
    () => groupByDateBucket(visibleEntries),
    [visibleEntries],
  );
  const hasActiveFilter = search.trim() !== "" || progressFilter !== "all";

  const openChapter = (chapterId: number) => {
    void navigate({ to: "/reader", search: { chapterId } });
  };
  const openNovel = (novelId: number) => {
    void navigate({ to: "/novel", search: { id: novelId } });
  };
  const continueReading = (entry: RecentlyReadEntry) => {
    if (entry.progress < FINISHED_PROGRESS) {
      openChapter(entry.chapterId);
      return;
    }

    void getAdjacentChapter(entry.novelId, entry.position, 1)
      .then((nextChapter) => openChapter(nextChapter?.id ?? entry.chapterId))
      .catch(() => openChapter(entry.chapterId));
  };

  return (
    <PageFrame className="lnr-history-page" size="wide">
      <PageHeader
        eyebrow="/history"
        title="Reading history"
        description="One latest read entry per novel - sorted by most recent."
      />

      {latestEntry ? (
        <div className="lnr-history-top-grid">
          <ResumePanel
            entry={latestEntry}
            nextChapterName={nextChapterQuery.data?.name ?? null}
            nextChapterPosition={nextChapterQuery.data?.position ?? null}
            checkingNextChapter={nextChapterQuery.isFetching}
            onOpenNovel={() => openNovel(latestEntry.novelId)}
            onContinueReading={() => {
              if (
                latestEntry.progress >= FINISHED_PROGRESS &&
                nextChapterQuery.data?.id
              ) {
                openChapter(nextChapterQuery.data.id);
                return;
              }
              continueReading(latestEntry);
            }}
          />
          <HistorySummaryPanel entries={visibleEntries} sections={sections} />
        </div>
      ) : null}

      <FilterBar
        progressFilter={progressFilter}
        search={search}
        onProgressFilterChange={setProgressFilter}
        onSearchChange={setSearch}
      />

      {query.isLoading ? (
        <HistoryLoadingState />
      ) : query.error ? (
        <StateView
          action={{
            label: "Retry",
            onClick: () => {
              void query.refetch();
            },
          }}
          color="red"
          title="Could not load history"
          message={
            query.error instanceof Error
              ? query.error.message
              : String(query.error)
          }
        />
      ) : sections.length > 0 ? (
        <Stack gap="lg">
          {sections.map((section) => (
            <HistorySection
              count={section.entries.length}
              key={section.label}
              title={section.label}
            >
              {section.entries.map((entry) => (
                <HistoryRow
                  key={entry.novelId}
                  entry={entry}
                  removingNovelId={
                    removeHistory.isPending
                      ? (removeHistory.variables ?? null)
                      : null
                  }
                  onOpenNovel={() => openNovel(entry.novelId)}
                  onContinueReading={() => continueReading(entry)}
                  onRemoveNovel={() => removeHistory.mutate(entry.novelId)}
                />
              ))}
            </HistorySection>
          ))}
        </Stack>
      ) : (
        <HistoryEmptyState
          hasSearch={hasActiveFilter}
          onOpenLibrary={() => void navigate({ to: "/" })}
        />
      )}
    </PageFrame>
  );
}
