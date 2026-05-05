import { useRef } from "react";
import { Card, Image, Text, useMantineTheme } from "@mantine/core";

const FALLBACK_COVER = "https://placehold.co/140x210?text=No+Cover";
const LONG_PRESS_MS = 500;

interface NovelCardProps {
  name: string;
  cover: string | null;
  selected?: boolean;
  /** Click/tap (without holding). Suppressed if a long press fired. */
  onActivate?: () => void;
  /** Pointer held for {@link LONG_PRESS_MS} ms. */
  onLongPress?: () => void;
}

export function NovelCard({
  name,
  cover,
  selected = false,
  onActivate,
  onLongPress,
}: NovelCardProps) {
  const theme = useMantineTheme();
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
      onLongPress();
      longPressTimer.current = null;
    }, LONG_PRESS_MS);
  };

  const handlePointerUp = () => {
    cancelTimer();
    if (!longPressed.current && onActivate) {
      onActivate();
    }
  };

  const handlePointerLeave = () => {
    cancelTimer();
  };

  const interactive = Boolean(onActivate || onLongPress);

  return (
    <Card
      padding="xs"
      radius="md"
      withBorder
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onPointerCancel={handlePointerLeave}
      style={{
        cursor: interactive ? "pointer" : "default",
        outline: selected
          ? `3px solid ${theme.colors[theme.primaryColor]?.[5] ?? theme.primaryColor}`
          : undefined,
        outlineOffset: -3,
        userSelect: "none",
      }}
    >
      <Card.Section>
        <Image
          src={cover ?? FALLBACK_COVER}
          fallbackSrc={FALLBACK_COVER}
          h={210}
          alt={name}
          draggable={false}
        />
      </Card.Section>
      <Text size="sm" fw={500} lineClamp={2} mt="xs" title={name}>
        {name}
      </Text>
    </Card>
  );
}
