import { type MouseEventHandler } from "react";
import { Tooltip, UnstyledButton } from "@mantine/core";
import { useTranslation } from "../i18n";

interface BackIconButtonProps {
  className?: string;
  label?: string;
  onClick: MouseEventHandler<HTMLButtonElement>;
}

export function BackIconButton({
  className,
  label,
  onClick,
}: BackIconButtonProps) {
  const { t } = useTranslation();
  const resolvedLabel = label ?? t("common.back");

  return (
    <Tooltip label={resolvedLabel} openDelay={350} withArrow>
      <UnstyledButton
        aria-label={resolvedLabel}
        className={
          className
            ? `lnr-back-icon-button ${className}`
            : "lnr-back-icon-button"
        }
        onClick={onClick}
        title={resolvedLabel}
        type="button"
      >
        <BackIcon />
      </UnstyledButton>
    </Tooltip>
  );
}

function BackIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M15 18l-6-6 6-6" />
      <path d="M9 12h11" />
    </svg>
  );
}
