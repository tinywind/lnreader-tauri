import type { ReactNode } from "react";
import {
  Box,
  Group,
  Image,
  Paper,
  Text,
  type BoxProps,
  type PaperProps,
} from "@mantine/core";

interface ConsoleCoverProps {
  alt: string;
  className?: string;
  fallbackSrc?: string;
  height?: number;
  src: string | null;
  width?: number;
}

export function ConsoleCover({
  alt,
  className,
  fallbackSrc,
  height = 72,
  src,
  width = 48,
}: ConsoleCoverProps) {
  const fallback = fallbackSrc ?? `https://placehold.co/${width}x${height}?text=?`;

  return (
    <Image
      className={`lnr-console-cover${className ? ` ${className}` : ""}`}
      src={src ?? fallback}
      fallbackSrc={fallback}
      alt={alt}
      w={width}
      h={height}
      radius={2}
      fit="cover"
    />
  );
}

interface ConsoleProgressProps {
  className?: string;
  status?: "active" | "done" | "idle";
  value: number;
}

export function ConsoleProgress({
  className,
  status = "active",
  value,
}: ConsoleProgressProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));

  return (
    <span
      className={`lnr-console-progress${className ? ` ${className}` : ""}`}
      aria-label={`${clamped}% progress`}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
    >
      <span
        className="lnr-console-progress-bar"
        data-status={status}
        style={{ width: `${clamped}%` }}
      />
    </span>
  );
}

interface ConsoleStatusDotProps {
  label: ReactNode;
  status?: "active" | "done" | "idle" | "warning" | "error";
}

export function ConsoleStatusDot({
  label,
  status = "idle",
}: ConsoleStatusDotProps) {
  return (
    <span className="lnr-console-status" data-status={status}>
      <span className="lnr-console-status-dot" aria-hidden />
      {label}
    </span>
  );
}

interface ConsoleChipProps {
  active?: boolean;
  children: ReactNode;
  tone?: "default" | "accent" | "error" | "warning" | "success";
}

export function ConsoleChip({
  active = false,
  children,
  tone = "default",
}: ConsoleChipProps) {
  return (
    <span className="lnr-console-chip" data-active={active} data-tone={tone}>
      {children}
    </span>
  );
}

interface ConsolePanelProps extends PaperProps {
  children: ReactNode;
  title?: ReactNode;
}

export function ConsolePanel({
  children,
  className,
  title,
  ...props
}: ConsolePanelProps) {
  return (
    <Paper
      className={`lnr-console-panel${className ? ` ${className}` : ""}`}
      radius={5}
      withBorder
      {...props}
    >
      {title ? <div className="lnr-console-panel-title">{title}</div> : null}
      {children}
    </Paper>
  );
}

interface ConsoleSectionHeaderProps {
  actions?: ReactNode;
  count?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
}

export function ConsoleSectionHeader({
  actions,
  count,
  eyebrow,
  title,
}: ConsoleSectionHeaderProps) {
  return (
    <Group className="lnr-console-section-header" justify="space-between">
      <Box style={{ minWidth: 0 }}>
        {eyebrow ? <Text className="lnr-console-kicker">{eyebrow}</Text> : null}
        <Group gap="xs" wrap="nowrap">
          <Text className="lnr-console-section-title" truncate>
            {title}
          </Text>
          {count ? <span className="lnr-console-section-count">{count}</span> : null}
        </Group>
      </Box>
      {actions ? (
        <Group gap="xs" justify="flex-end" wrap="wrap">
          {actions}
        </Group>
      ) : null}
    </Group>
  );
}

interface ConsoleStatusStripProps extends BoxProps {
  children: ReactNode;
}

export function ConsoleStatusStrip({
  children,
  className,
  ...props
}: ConsoleStatusStripProps) {
  return (
    <Box
      className={`lnr-console-status-strip${className ? ` ${className}` : ""}`}
      {...props}
    >
      {children}
    </Box>
  );
}
