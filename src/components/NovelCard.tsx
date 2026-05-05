import { Card, Image, Text } from "@mantine/core";

interface NovelCardProps {
  name: string;
  cover: string | null;
}

const FALLBACK_COVER = "https://placehold.co/140x210?text=No+Cover";

export function NovelCard({ name, cover }: NovelCardProps) {
  return (
    <Card padding="xs" radius="md" withBorder>
      <Card.Section>
        <Image
          src={cover ?? FALLBACK_COVER}
          fallbackSrc={FALLBACK_COVER}
          h={210}
          alt={name}
        />
      </Card.Section>
      <Text size="sm" fw={500} lineClamp={2} mt="xs" title={name}>
        {name}
      </Text>
    </Card>
  );
}
