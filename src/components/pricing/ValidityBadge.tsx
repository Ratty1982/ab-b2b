import { StatusBadge } from "@/components/ab/Badges";

export function ValidityBadge({ status }: { status: string }) {
  const tone =
    status === "active" || status === "Active" || status === "Live" || status === "Default"
      ? "good"
      : status === "scheduled" || status === "Scheduled"
        ? "info"
        : status === "expired" || status === "Expired" || status === "disabled" || status === "Disabled"
          ? "neutral"
          : "neutral";
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return <StatusBadge tone={tone}>{label}</StatusBadge>;
}
