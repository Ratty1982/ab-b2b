import { PUBLIC_AVAILABILITY_LABEL, type PublicAvailability } from "@/domain/availability";
import { StatusBadge, type Tone } from "@/components/ab/Badges";

const tone: Record<PublicAvailability, Tone> = {
  in: "good",
  low: "warn",
  out: "bad",
  backorder: "info",
  partial: "warn",
};

/** Customer-facing stock state. Never include a quantity. */
export function AvailabilityBadge({
  availability,
}: {
  availability: PublicAvailability | null | undefined;
}) {
  if (!availability) return null;
  return (
    <StatusBadge tone={tone[availability]}>
      <span aria-hidden className="text-[8px]">
        ●
      </span>
      {PUBLIC_AVAILABILITY_LABEL[availability]}
    </StatusBadge>
  );
}

export function availabilityClass(availability: PublicAvailability | null | undefined): string {
  if (availability === "in") return "text-good";
  if (availability === "low") return "text-warn";
  if (availability === "backorder") return "text-cyan";
  if (availability === "partial") return "text-warn";
  if (availability === "out") return "text-destructive";
  return "text-steel";
}
