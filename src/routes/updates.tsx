import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Group,
  Loader,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { DownloadGlyph, DownloadedGlyph } from "../components/ActionGlyphs";
import {
  ConsoleCover,
  ConsolePanel,
  ConsoleSectionHeader,
  ConsoleStatusDot,
  ConsoleStatusStrip,
} from "../components/ConsolePrimitives";
import { PageFrame, PageHeader, StateView } from "../components/AppFrame";
import {
  listLibraryUpdatesPage,
  type LibraryUpdateEntry,
} from "../db/queries/chapter";
import { downloadQueue, type DownloadStatus } from "../lib/download/queue";
import {
  checkLibraryUpdates,
  type UpdateCheckFailure,
  type UpdateCheckResult,
} from "../lib/updates/check-library-updates";
import {
  formatDateTimeForLocale,
  useTranslation,
  type AppLocale,
  type TranslationKey,
} from "../i18n";
import { useUpdatesStore } from "../store/updates";
import "../styles/updates.css";

const UPDATES_PAGE_SIZE = 100;
const LOAD_MORE_THRESHOLD_PX = 480;

function formatDateTime(epochSeconds: number, locale: AppLocale): string {
  return formatDateTimeForLocale(locale, epochSeconds * 1000);
}

function countLabel(
  t: ReturnType<typeof useTranslation>["t"],
  value: number,
  singularKey: TranslationKey,
  pluralKey: TranslationKey,
): string {
  return t(value === 1 ? singularKey : pluralKey, { count: value });
}

interface SourceUpdateState {
  failures: number;
  pluginId: string;
  updates: number;
}

function getSourceStates(
  result: UpdateCheckResult | undefined,
  updates: LibraryUpdateEntry[] = result?.updates ?? [],
): SourceUpdateState[] {
  if (!result && updates.length === 0) return [];
  const sources = new Map<string, SourceUpdateState>();

  for (const entry of updates) {
    const current =
      sources.get(entry.pluginId) ??
      { failures: 0, pluginId: entry.pluginId, updates: 0 };
    current.updates += 1;
    sources.set(entry.pluginId, current);
  }

  for (const failure of result?.failures ?? []) {
    const current =
      sources.get(failure.pluginId) ??
      { failures: 0, pluginId: failure.pluginId, updates: 0 };
    current.failures += 1;
    sources.set(failure.pluginId, current);
  }

  return [...sources.values()].sort((a, b) =>
    a.pluginId.localeCompare(b.pluginId),
  );
}

interface UpdateSummaryProps {
  hasMoreUpdates: boolean;
  loadedUpdates: number;
  result: UpdateCheckResult | undefined;
  running: boolean;
}

function UpdateSummary({
  hasMoreUpdates,
  loadedUpdates,
  result,
  running,
}: UpdateSummaryProps) {
  const { t } = useTranslation();
  const failures = result?.failures.length ?? 0;
  const checked = result?.checkedNovels ?? 0;
  const skipped = result?.skippedNovels ?? 0;

  return (
    <ConsolePanel className="lnr-updates-summary">
      <div className="lnr-updates-summary-grid">
        <div className="lnr-updates-summary-queue">
          <Text className="lnr-console-kicker">{t("updates.queueState")}</Text>
          <Group gap="xs" mt={6} wrap="wrap">
            <ConsoleStatusDot
              status={running ? "active" : failures > 0 ? "warning" : "idle"}
              label={
                running
                  ? t("common.checking")
                  : result
                    ? t("common.ready")
                    : t("settings.idle")
              }
            />
            <UpdateFlag
              count={loadedUpdates}
              label={countLabel(
                t,
                loadedUpdates,
                "updates.loadedUpdateCount",
                "updates.loadedUpdateCountPlural",
              )}
              tone={loadedUpdates > 0 ? "accent" : "default"}
            >
              <RefreshIcon />
            </UpdateFlag>
            {hasMoreUpdates ? (
              <UpdateFlag label={t("updates.moreAvailable")} tone="accent">
                <PlusIcon />
              </UpdateFlag>
            ) : null}
            <UpdateFlag
              count={failures}
              label={countLabel(
                t,
                failures,
                "updates.failureCount",
                "updates.failureCountPlural",
              )}
              tone={failures > 0 ? "warning" : "default"}
            >
              <AlertIcon />
            </UpdateFlag>
          </Group>
        </div>

        <div className="lnr-updates-summary-source">
          <Text className="lnr-console-kicker">{t("updates.sourceCheck")}</Text>
          <Text className="lnr-updates-summary-value" mt={4}>
            {countLabel(
              t,
              checked,
              "updates.novelCount",
              "updates.novelCountPlural",
            )}
          </Text>
          <Text className="lnr-updates-summary-copy">
            {skipped > 0
              ? countLabel(
                  t,
                  skipped,
                  "updates.localNovelSkipped",
                  "updates.localNovelSkippedPlural",
                )
              : t("updates.noLocalSkipped")}
          </Text>
        </div>

        <div className="lnr-updates-summary-limit">
          <Text className="lnr-console-kicker">{t("updates.limit")}</Text>
          <Text className="lnr-updates-summary-value" mt={4}>
            {UPDATES_PAGE_SIZE}
          </Text>
          <Text className="lnr-updates-summary-copy">
            {t("updates.rowsLoadedPerPage")}
          </Text>
        </div>
      </div>
    </ConsolePanel>
  );
}

function SourceStatePanel({
  result,
  running,
  onRetry,
  updates,
}: {
  result: UpdateCheckResult | undefined;
  running: boolean;
  onRetry: () => void;
  updates: LibraryUpdateEntry[];
}) {
  const { t } = useTranslation();
  const sources = getSourceStates(result, updates);

  return (
    <ConsolePanel
      className="lnr-updates-source-state"
      title={t("updates.sourceState")}
    >
      {sources.length > 0 ? (
        <div className="lnr-updates-source-grid">
          {sources.map((source) => {
            const status =
              source.failures > 0
                ? "error"
                : source.updates > 0
                  ? "active"
                  : "done";
            return (
              <div className="lnr-updates-source-row" key={source.pluginId}>
                <ConsoleStatusDot status={status} label={source.pluginId} />
                <UpdateFlag
                  count={source.updates}
                  label={countLabel(
                    t,
                    source.updates,
                    "updates.updateCount",
                    "updates.updateCountPlural",
                  )}
                  tone={source.updates > 0 ? "accent" : "default"}
                >
                  <RefreshIcon />
                </UpdateFlag>
                <UpdateFlag
                  count={source.failures}
                  label={countLabel(
                    t,
                    source.failures,
                    "updates.failureCount",
                    "updates.failureCountPlural",
                  )}
                  tone={source.failures > 0 ? "error" : "default"}
                >
                  <AlertIcon />
                </UpdateFlag>
                {source.failures > 0 ? (
                  <UpdateIconButton
                    className="lnr-updates-source-retry"
                    disabled={running}
                    label={t("updates.retrySource")}
                    onClick={onRetry}
                    tone="accent"
                  >
                    {running ? <SpinnerIcon /> : <RefreshIcon />}
                  </UpdateIconButton>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="lnr-updates-source-empty">
          <ConsoleStatusDot
            status={running ? "active" : "idle"}
            label={
              running ? t("updates.checkingSources") : t("updates.noSourceState")
            }
          />
        </div>
      )}
    </ConsolePanel>
  );
}

interface FailureRowProps {
  failure: UpdateCheckFailure;
  onOpenNovel: () => void;
}

function FailureRow({ failure, onOpenNovel }: FailureRowProps) {
  const { t } = useTranslation();

  return (
    <div className="lnr-updates-failure-row">
      <div className="lnr-updates-failure-main">
        <Group gap="xs" wrap="nowrap">
          <ConsoleStatusDot status="error" label={t("common.failed")} />
          <button
            className="lnr-updates-link"
            type="button"
            onClick={onOpenNovel}
          >
            {failure.novelName}
          </button>
        </Group>
        <Text className="lnr-updates-row-meta" title={failure.reason}>
          {failure.pluginId} / {failure.reason}
        </Text>
      </div>
      <UpdateIconButton label={t("updates.details")} onClick={onOpenNovel}>
        <DetailsIcon />
      </UpdateIconButton>
    </div>
  );
}

interface UpdateIconButtonProps {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  tone?: "default" | "accent" | "error";
}

function UpdateIconButton({
  children,
  className,
  disabled = false,
  label,
  onClick,
  tone = "default",
}: UpdateIconButtonProps) {
  const classNames = `lnr-updates-icon-button${
    className ? ` ${className}` : ""
  }`;

  return (
    <Tooltip label={label} openDelay={350} withArrow>
      <UnstyledButton
        aria-label={label}
        className={classNames}
        data-tone={tone}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
        title={label}
        type="button"
      >
        {children}
      </UnstyledButton>
    </Tooltip>
  );
}

interface UpdateFlagProps {
  children: ReactNode;
  count?: number;
  label: string;
  tone?: "accent" | "default" | "done" | "error" | "warning";
}

function UpdateFlag({
  children,
  count,
  label,
  tone = "default",
}: UpdateFlagProps) {
  const hasCount = count != null;

  return (
    <Tooltip label={label} openDelay={350} withArrow>
      <span
        aria-label={label}
        className="lnr-updates-icon-flag"
        data-count={hasCount ? "true" : undefined}
        data-tone={tone}
        role="img"
        title={label}
      >
        {children}
        {hasCount ? (
          <span className="lnr-updates-icon-count">{count}</span>
        ) : null}
      </span>
    </Tooltip>
  );
}

function UpdateDownloadStatusFlag({
  status,
}: {
  status: DownloadStatus | undefined;
}) {
  const { t } = useTranslation();

  if (!status || status.kind === "done" || status.kind === "cancelled") {
    return null;
  }

  if (status.kind === "failed") {
    return (
      <UpdateFlag label={status.error} tone="error">
        <AlertIcon />
      </UpdateFlag>
    );
  }

  if (status.kind === "running") {
    return (
      <UpdateFlag label={t("common.downloading")}>
        <SpinnerIcon />
      </UpdateFlag>
    );
  }

  return (
    <UpdateFlag label={t("common.queued")}>
      <ClockIcon />
    </UpdateFlag>
  );
}

interface UpdateRowProps {
  downloadStatus: DownloadStatus | undefined;
  entry: LibraryUpdateEntry;
  onDownload: () => void;
  onOpen: () => void;
  onOpenNovel: () => void;
}

function UpdateRow({
  downloadStatus,
  entry,
  onDownload,
  onOpen,
  onOpenNovel,
}: UpdateRowProps) {
  const { locale, t } = useTranslation();
  const isQueued = downloadStatus?.kind === "queued";
  const isRunning = downloadStatus?.kind === "running";
  const failedMessage =
    downloadStatus?.kind === "failed" ? downloadStatus.error : null;
  const status = entry.isDownloaded ? "done" : "active";
  const downloadLabel = failedMessage
    ? `${t("novel.retryDownload")}: ${failedMessage}`
    : isRunning
      ? t("common.downloading")
      : isQueued
        ? t("common.queued")
        : t("novel.downloadChapter");

  return (
    <div
      className="lnr-updates-row"
      role="button"
      tabIndex={0}
      aria-label={t("updates.openChapter", { name: entry.chapterName })}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onOpen();
      }}
    >
      <ConsoleCover
        alt={entry.novelName}
        height={72}
        src={entry.novelCover}
        width={48}
      />

      <div className="lnr-updates-row-main">
        <Group gap="xs" wrap="nowrap">
          <ConsoleStatusDot
            status={status}
            label={entry.isDownloaded ? t("common.downloaded") : t("common.new")}
          />
          <button
            className="lnr-updates-link"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpenNovel();
            }}
          >
            {entry.novelName}
          </button>
        </Group>
        <Text className="lnr-updates-row-title" title={entry.chapterName}>
          #{entry.position} - {entry.chapterName}
        </Text>
        <Group gap="xs" mt={6} wrap="wrap">
          <span className="lnr-updates-row-flags" aria-label={t("novel.chapterStatus")}>
            <UpdateFlag label={entry.pluginId}>
              <SourceIcon />
            </UpdateFlag>
            <UpdateFlag label={t("library.grid.unread")} tone="accent">
              <UnreadIcon />
            </UpdateFlag>
            {entry.isDownloaded ? (
              <UpdateFlag label={t("novel.downloaded")} tone="done">
                <DownloadedGlyph />
              </UpdateFlag>
            ) : null}
            <UpdateDownloadStatusFlag status={downloadStatus} />
          </span>
          <Text className="lnr-updates-row-meta">
            {t("updates.foundAt", {
              date: formatDateTime(entry.foundAt, locale),
            })}
          </Text>
        </Group>
      </div>

      <div className="lnr-updates-row-actions">
        <UpdateIconButton label={t("common.read")} onClick={onOpen} tone="accent">
          <ReadForwardIcon />
        </UpdateIconButton>
        {!entry.isDownloaded ? (
          <UpdateIconButton
            disabled={isQueued || isRunning}
            label={downloadLabel}
            onClick={onDownload}
            tone={failedMessage ? "error" : "default"}
          >
            {isRunning ? (
              <SpinnerIcon />
            ) : isQueued ? (
              <ClockIcon />
            ) : (
              <DownloadGlyph />
            )}
          </UpdateIconButton>
        ) : null}
        <UpdateIconButton label={t("updates.details")} onClick={onOpenNovel}>
          <DetailsIcon />
        </UpdateIconButton>
      </div>
    </div>
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

function UnreadIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M5 5h14v14H5z" />
      <path d="M8 10h6" />
      <path d="M8 14h5" />
      <circle cx="17" cy="7" r="2" />
    </svg>
  );
}

function DetailsIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
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
    <svg
      className="lnr-updates-spin-icon"
      aria-hidden="true"
      viewBox="0 0 24 24"
    >
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

function RefreshIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 4v5h-5" />
    </svg>
  );
}

function SourceIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18" />
      <path d="M12 3a14 14 0 0 0 0 18" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

export function UpdatesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const hasLoaded = useUpdatesStore((state) => state.hasLoaded);
  const hasMoreUpdates = useUpdatesStore((state) => state.hasMoreUpdates);
  const lastCheckResult = useUpdatesStore((state) => state.lastCheckResult);
  const nextUpdateOffset = useUpdatesStore(
    (state) => state.nextUpdateOffset,
  );
  const updates = useUpdatesStore((state) => state.updates);
  const appendPage = useUpdatesStore((state) => state.appendPage);
  const applyCheckResult = useUpdatesStore(
    (state) => state.applyCheckResult,
  );
  const markChapterDownloaded = useUpdatesStore(
    (state) => state.markChapterDownloaded,
  );
  const mergeFirstPage = useUpdatesStore((state) => state.mergeFirstPage);
  const [downloadStatuses, setDownloadStatuses] = useState<
    ReadonlyMap<number, DownloadStatus>
  >(() => new Map());

  const refresh = useMutation({
    mutationFn: () => listLibraryUpdatesPage(UPDATES_PAGE_SIZE),
    onSuccess: mergeFirstPage,
  });

  const check = useMutation({
    mutationFn: () => checkLibraryUpdates(UPDATES_PAGE_SIZE),
    onSuccess: applyCheckResult,
  });

  const loadMore = useMutation({
    mutationFn: (offset: number) =>
      listLibraryUpdatesPage(UPDATES_PAGE_SIZE, offset),
    onSuccess: appendPage,
  });
  const isInitialLoading = refresh.isPending && !hasLoaded;
  const isLoadingMore = loadMore.isPending;
  const refreshFirstPage = refresh.mutate;
  const loadMorePage = loadMore.mutate;

  const loadMoreIfNeeded = useCallback(() => {
    if (
      !hasLoaded ||
      refresh.isPending ||
      check.isPending ||
      isLoadingMore ||
      !hasMoreUpdates
    ) {
      return;
    }

    const scrollElement = document.scrollingElement ?? document.documentElement;
    const distanceToBottom =
      scrollElement.scrollHeight - window.innerHeight - scrollElement.scrollTop;

    if (distanceToBottom <= LOAD_MORE_THRESHOLD_PX) {
      loadMorePage(nextUpdateOffset);
    }
  }, [
    check.isPending,
    hasLoaded,
    hasMoreUpdates,
    isLoadingMore,
    loadMorePage,
    nextUpdateOffset,
    refresh.isPending,
  ]);

  useEffect(() => {
    refreshFirstPage();
  }, [refreshFirstPage]);

  useEffect(() => {
    return downloadQueue.subscribe((event) => {
      setDownloadStatuses((current) => {
        const next = new Map(current);
        if (event.status.kind === "cancelled") {
          next.delete(event.job.id);
        } else {
          next.set(event.job.id, event.status);
        }
        return next;
      });
      if (event.status.kind === "done") {
        markChapterDownloaded(event.job.id);
        void queryClient.invalidateQueries({ queryKey: ["novel"] });
      }
    });
  }, [markChapterDownloaded, queryClient]);

  useEffect(() => {
    for (const entry of updates) {
      const status = downloadQueue.status(entry.chapterId);
      if (status?.kind === "done" && !entry.isDownloaded) {
        markChapterDownloaded(entry.chapterId);
      }
    }

    setDownloadStatuses((current) => {
      let changed = false;
      const next = new Map(current);
      for (const entry of updates) {
        const status = downloadQueue.status(entry.chapterId);
        if (status?.kind === "cancelled") {
          if (next.delete(entry.chapterId)) changed = true;
          continue;
        }
        if (status && next.get(entry.chapterId) !== status) {
          next.set(entry.chapterId, status);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [markChapterDownloaded, updates]);

  useEffect(() => {
    window.addEventListener("scroll", loadMoreIfNeeded, { passive: true });
    window.addEventListener("resize", loadMoreIfNeeded);
    return () => {
      window.removeEventListener("scroll", loadMoreIfNeeded);
      window.removeEventListener("resize", loadMoreIfNeeded);
    };
  }, [loadMoreIfNeeded]);

  useEffect(() => {
    loadMoreIfNeeded();
  }, [loadMoreIfNeeded, updates.length]);

  const openChapter = (chapterId: number) => {
    void navigate({ to: "/reader", search: { chapterId } });
  };
  const openNovel = (novelId: number) => {
    void navigate({ to: "/novel", search: { id: novelId } });
  };
  const downloadChapter = (entry: LibraryUpdateEntry) => {
    downloadQueue.enqueue({
      id: entry.chapterId,
      pluginId: entry.pluginId,
      chapterPath: entry.chapterPath,
    });
  };

  const result = lastCheckResult ?? undefined;

  return (
    <PageFrame className="lnr-updates-page" size="wide">
      <PageHeader
        eyebrow="/updates"
        title={t("updates.title")}
        description={t("updates.description")}
        actions={
          <UpdateIconButton
            className="lnr-updates-check-button"
            disabled={check.isPending}
            label={t("updates.check")}
            onClick={() => check.mutate()}
            tone="accent"
          >
            {check.isPending ? <SpinnerIcon /> : <RefreshIcon />}
          </UpdateIconButton>
        }
      />

      <UpdateSummary
        hasMoreUpdates={hasMoreUpdates}
        loadedUpdates={updates.length}
        result={result}
        running={check.isPending || refresh.isPending}
      />
      <SourceStatePanel
        result={result}
        running={check.isPending}
        onRetry={() => check.mutate()}
        updates={updates}
      />

      {isInitialLoading ? (
        <StateView
          title={
            <Group gap="sm">
              <Loader size="sm" />
              <Text c="dimmed">{t("updates.loadingRecent")}</Text>
            </Group>
          }
        />
      ) : refresh.error && !hasLoaded ? (
        <StateView
          action={{
            icon: <RefreshIcon />,
            iconOnly: true,
            label: t("common.retry"),
            onClick: () => refreshFirstPage(),
          }}
          color="red"
          title={t("updates.loadFailed")}
          message={
            refresh.error instanceof Error
              ? refresh.error.message
              : String(refresh.error)
          }
        />
      ) : (
        <Stack gap="md">
          {check.isPending ? (
            <StateView
              title={
                <Group gap="sm">
                  <Loader size="sm" />
                  <Text c="dimmed">{t("updates.checkingLibrarySources")}</Text>
                </Group>
              }
            />
          ) : check.error ? (
            <StateView
              action={{
                icon: <RefreshIcon />,
                iconOnly: true,
                label: t("common.retry"),
                onClick: () => check.mutate(),
              }}
              color="red"
              title={t("updates.checkFailed")}
              message={
                check.error instanceof Error
                  ? check.error.message
                  : String(check.error)
              }
            />
          ) : result && result.failures.length > 0 ? (
            <ConsolePanel
              className="lnr-updates-failures"
              title={t("updates.sourceFailures")}
            >
              <Stack gap={0}>
                {result.failures.map((failure) => (
                  <FailureRow
                    key={failure.novelId}
                    failure={failure}
                    onOpenNovel={() => openNovel(failure.novelId)}
                  />
                ))}
              </Stack>
              <div className="lnr-updates-failure-footer">
                <Text className="lnr-updates-row-meta">
                  {t("updates.failureFooter")}
                </Text>
                <UpdateIconButton
                  className="lnr-updates-footer-action"
                  disabled={check.isPending}
                  label={t("updates.retryFailedCheck")}
                  onClick={() => check.mutate()}
                  tone="accent"
                >
                  {check.isPending ? <SpinnerIcon /> : <RefreshIcon />}
                </UpdateIconButton>
              </div>
            </ConsolePanel>
          ) : null}

          <ConsolePanel className="lnr-updates-queue">
            <ConsoleSectionHeader
              eyebrow={t("updates.workQueue")}
              title={t("updates.unreadChapterUpdates")}
              count={`${countLabel(
                t,
                updates.length,
                "updates.loadedRowCount",
                "updates.loadedRowCountPlural",
              )}${hasMoreUpdates ? ` / ${t("updates.moreAvailable")}` : ""}`}
            />

            {updates.length > 0 ? (
              <Stack gap={0} mt="sm">
                {updates.map((entry) => (
                  <UpdateRow
                    key={entry.chapterId}
                    downloadStatus={downloadStatuses.get(entry.chapterId)}
                    entry={entry}
                    onDownload={() => downloadChapter(entry)}
                    onOpen={() => openChapter(entry.chapterId)}
                    onOpenNovel={() => openNovel(entry.novelId)}
                  />
                ))}
                {hasMoreUpdates ? (
                  <div className="lnr-updates-load-more">
                    <UpdateIconButton
                      className="lnr-updates-load-more-action"
                      disabled={isLoadingMore}
                      label={t("updates.loadMore")}
                      onClick={() => loadMorePage(nextUpdateOffset)}
                      tone="accent"
                    >
                      {isLoadingMore ? <SpinnerIcon /> : <PlusIcon />}
                    </UpdateIconButton>
                    <Text className="lnr-updates-row-meta">
                      {t("updates.autoLoadMore")}
                    </Text>
                  </div>
                ) : null}
              </Stack>
            ) : (
              <StateView
                color="blue"
                title={t("updates.caughtUp")}
                message={t("updates.caughtUpCurrentMessage")}
              />
            )}
          </ConsolePanel>
        </Stack>
      )}

      <ConsoleStatusStrip>
        <span>
          {check.isPending
            ? t("updates.checkingSourcesLabel")
            : refresh.isPending
              ? t("updates.refreshingLocalUpdates")
              : result
                ? countLabel(
                    t,
                    result.checkedNovels,
                    "updates.checkedNovelCount",
                    "updates.checkedNovelCountPlural",
                  )
                : hasLoaded
                  ? t("updates.localUpdatesLoaded")
                  : t("updates.noLocalUpdatesLoaded")}
        </span>
        <span>
          {result
            ? countLabel(
                t,
                result.skippedNovels,
                "updates.skippedLocalNovelCount",
                "updates.skippedLocalNovelCountPlural",
              )
            : hasLoaded
              ? t("updates.manualSourceCheckAvailable")
              : t("common.loading")}
        </span>
        <span>
          {`${countLabel(
            t,
            updates.length,
            "updates.loadedUpdateCount",
            "updates.loadedUpdateCountPlural",
          )}${hasMoreUpdates ? ` / ${t("common.more")}` : ""}`}
        </span>
      </ConsoleStatusStrip>
    </PageFrame>
  );
}
