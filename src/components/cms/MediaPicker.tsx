import { Drawer } from "@/components/ab/Drawer";
import { MediaLibraryPanel, type CmsMediaListItem } from "@/components/cms/MediaLibraryPanel";

export type { CmsMediaListItem };

export function MediaPicker({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (item: CmsMediaListItem) => void;
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
          onPick={(item) => {
            onSelect(item);
            onClose();
          }}
        />
      ) : null}
    </Drawer>
  );
}
