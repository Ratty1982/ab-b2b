import { useMemo, useRef } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2 } from "lucide-react";
import { inputClass } from "@/components/ab/Drawer";
import { moveListItem } from "@/domain/product-content-editor";
import { cn } from "@/lib/utils";

function SortableItem({
  id,
  value,
  placeholder,
  compact,
  onChange,
  onRemove,
}: {
  id: string;
  value: string;
  placeholder: string;
  compact?: boolean | undefined;
  onChange: (value: string) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("flex items-center gap-1 rounded-md border border-border bg-ink/40 p-1.5", compact && "max-w-xl")}
    >
      <button
        type="button"
        className="grid size-8 shrink-0 place-items-center text-steel"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-3.5" aria-hidden />
      </button>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={cn(inputClass, "min-h-9")}
      />
      <button
        type="button"
        className="grid size-8 shrink-0 place-items-center text-steel hover:text-bad"
        aria-label="Remove item"
        onClick={onRemove}
      >
        <Trash2 className="size-3.5" aria-hidden />
      </button>
    </li>
  );
}

export function EditableStringList({
  value,
  onChange,
  addLabel,
  placeholder,
  compact,
  emptyLabel,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  addLabel: string;
  placeholder: string;
  compact?: boolean;
  emptyLabel?: string;
}) {
  const ids = useRef<string[]>([]);
  while (ids.current.length < value.length) ids.current.push(`row-${ids.current.length}-${Math.random().toString(36).slice(2, 8)}`);
  if (ids.current.length > value.length) ids.current = ids.current.slice(0, value.length);
  const itemIds = ids.current;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const sortableIds = useMemo(() => itemIds.slice(0, value.length), [itemIds, value.length]);

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = sortableIds.indexOf(String(active.id));
    const to = sortableIds.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const nextIds = moveListItem(sortableIds, from, to);
    ids.current = nextIds;
    onChange(moveListItem(value, from, to));
  }

  return (
    <div>
      {value.length ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
            <ul className="grid gap-2">
              {value.map((item, index) => {
                const id = sortableIds[index] ?? `row-${index}`;
                return (
                  <SortableItem
                    key={id}
                    id={id}
                    value={item}
                    placeholder={placeholder}
                    compact={compact}
                    onChange={(next) => onChange(value.map((current, i) => (i === index ? next : current)))}
                    onRemove={() => {
                      ids.current = ids.current.filter((_, i) => i !== index);
                      onChange(value.filter((_, i) => i !== index));
                    }}
                  />
                );
              })}
            </ul>
          </SortableContext>
        </DndContext>
      ) : (
        <p className="text-[12px] text-steel">{emptyLabel ?? "None yet."}</p>
      )}
      <button
        type="button"
        className="mt-2 text-[12px] font-semibold text-primary"
        onClick={() => onChange([...value, ""])}
      >
        {addLabel}
      </button>
    </div>
  );
}
