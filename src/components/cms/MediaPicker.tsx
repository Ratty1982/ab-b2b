import { Drawer } from "@/components/ab/Drawer";
import { MediaLibraryPanel, type CmsMediaListItem } from "@/components/cms/MediaLibraryPanel";
import { defaultMediaUsage, type MediaUploadUsage } from "@/domain/media-usage";

export type { CmsMediaListItem };

export function MediaPicker({
  open,
  onClose,
  onSelect,
  usage = defaultMediaUsage(),
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (item: CmsMediaListItem) => void;
  usage?: MediaUploadUsage;
}) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Choose image"
      sub="Library or upload JPEG, PNG, WebP, GIF (max 8 MB)"
      width="lg"
    >
      {open ? (
        <MediaLibraryPanel
          usage={usage}
          onPick={(item) => {
            onSelect(item);
            onClose();
          }}
        />
      ) : null}
    </Drawer>
  );
}
