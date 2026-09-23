import {
  canonicalUtc,
  formatAuditDateTime,
  formatDate,
  formatOperationalDateTime,
  formatOrDash,
  type InstantInput,
} from "@/lib/datetime";
import { cn } from "@/lib/utils";

type Variant = "operational" | "audit" | "date";

export function InstantText({
  value,
  variant = "operational",
  empty = "—",
  className,
}: {
  value: InstantInput;
  variant?: Variant;
  empty?: string;
  className?: string;
}) {
  const formatted =
    variant === "date"
      ? formatDate(value)
      : variant === "audit"
        ? formatAuditDateTime(value)
        : formatOperationalDateTime(value);
  const text = formatOrDash(formatted, empty);
  const utc = canonicalUtc(value);
  return (
    <span className={cn("num", className)} title={utc ?? undefined}>
      {text}
    </span>
  );
}
