import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Alert,
  Anchor,
  Container,
  Group,
  Image,
  Loader,
  Paper,
  Progress,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import {
  listRecentlyRead,
  type RecentlyReadEntry,
} from "../db/queries/chapter";

const HISTORY_LIMIT = 100;
const FALLBACK_COVER = "https://placehold.co/56x84?text=?";

function formatDateTime(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleString();
}

interface HistoryRowProps {
  entry: RecentlyReadEntry;
  onOpen: () => void;
  onOpenNovel: () => void;
}

function HistoryRow({ entry, onOpen, onOpenNovel }: HistoryRowProps) {
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
      <Group wrap="nowrap" align="flex-start" gap="md">
        <Image
          src={entry.novelCover ?? FALLBACK_COVER}
          fallbackSrc={FALLBACK_COVER}
          w={56}
          h={84}
          alt={entry.novelName}
          radius="xs"
        />
        <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
          <Anchor
            size="sm"
            fw={600}
            onClick={(event) => {
              event.stopPropagation();
              onOpenNovel();
            }}
            style={{ cursor: "pointer" }}
          >
            {entry.novelName}
          </Anchor>
          <Text size="sm" lineClamp={1} title={entry.chapterName}>
            #{entry.position} — {entry.chapterName}
          </Text>
          <Text size="xs" c="dimmed">
            Read {formatDateTime(entry.readAt)}
          </Text>
          {entry.progress > 0 && entry.progress < 100 && (
            <Progress value={entry.progress} size="xs" mt={2} />
          )}
        </Stack>
      </Group>
    </Paper>
  );
}

export function HistoryPage() {
  const navigate = useNavigate();

  const query = useQuery({
    queryKey: ["chapter", "history", HISTORY_LIMIT] as const,
    queryFn: () => listRecentlyRead(HISTORY_LIMIT),
  });

  const openChapter = (chapterId: number) => {
    void navigate({ to: "/reader", search: { chapterId } });
  };
  const openNovel = (novelId: number) => {
    void navigate({ to: "/novel", search: { id: novelId } });
  };

  return (
    <Container py="lg" size="md">
      <Stack gap="md">
        <Title order={2}>History</Title>

        {query.isLoading ? (
          <Group gap="sm">
            <Loader size="sm" />
            <Text c="dimmed">Loading history…</Text>
          </Group>
        ) : query.error ? (
          <Alert color="red" title="Failed to load history">
            {query.error instanceof Error
              ? query.error.message
              : String(query.error)}
          </Alert>
        ) : query.data && query.data.length > 0 ? (
          <Stack gap="xs">
            {query.data.map((entry) => (
              <HistoryRow
                key={entry.chapterId}
                entry={entry}
                onOpen={() => openChapter(entry.chapterId)}
                onOpenNovel={() => openNovel(entry.novelId)}
              />
            ))}
          </Stack>
        ) : (
          <Alert color="blue" variant="light" title="No reading yet">
            Chapters you finish reading will show up here.
          </Alert>
        )}
      </Stack>
    </Container>
  );
}
