import { catalogueMediaClass, catalogueStageClass } from "@/lib/media-presentation";
import { cn } from "@/lib/utils";

/** Square or letterboxed frame that always shows the full product. */
export function CatalogueMedia({
  src,
  alt = "",
  className,
  imgClassName,
}: {
  src?: string | null;
  alt?: string;
  className?: string;
  imgClassName?: string;
}) {
  return (
    <div className={cn("overflow-hidden", catalogueStageClass, className)}>
      {src ? <img src={src} alt={alt} className={cn(catalogueMediaClass, imgClassName)} /> : null}
    </div>
  );
}
