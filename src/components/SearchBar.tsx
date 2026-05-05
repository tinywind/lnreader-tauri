import { CloseButton, TextInput } from "@mantine/core";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

export function SearchBar({ value, onChange }: SearchBarProps) {
  return (
    <TextInput
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      placeholder="Search library…"
      size="sm"
      style={{ flex: 1, maxWidth: 480 }}
      rightSection={
        value.length > 0 ? (
          <CloseButton
            size="sm"
            aria-label="Clear search"
            onClick={() => onChange("")}
          />
        ) : null
      }
    />
  );
}
