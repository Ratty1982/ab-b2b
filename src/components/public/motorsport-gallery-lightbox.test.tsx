// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { MotorsportMediaGallery } from "@/components/public/MotorsportMediaGallery";

function photo(index: number) {
  return {
    mediaId: `media-${index}`,
    alt: `Race photograph ${index}`,
    caption: index === 2 ? "Pit lane" : "",
    fit: "fill" as const,
    focalX: 50,
    focalY: 50,
  };
}

function mount(node: ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return {
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function click(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function key(name: string, init: KeyboardEventInit = {}) {
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }));
  });
}

function button(label: string) {
  return document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
}

const mounted: Array<{ unmount: () => void }> = [];

afterEach(() => {
  for (const view of mounted.splice(0)) view.unmount();
  document.body.style.overflow = "";
  document.documentElement.style.overflow = "";
});

describe("motorsport gallery lightbox", () => {
  it("opens the chosen photograph and restores focus, scroll, and keyboard order", () => {
    document.body.style.overflow = "scroll";
    document.documentElement.style.overflow = "auto";
    mounted.push(
      mount(
        createElement(MotorsportMediaGallery, {
          config: { heading: "Gallery", items: [1, 2, 3].map((index) => photo(index)) },
        }),
      ),
    );

    const third = button("View photograph 3 of 3: Race photograph 3");
    expect(third).toBeTruthy();
    click(third!);

    const dialog = document.querySelector("[data-gallery-lightbox]");
    expect(dialog?.getAttribute("role")).toBe("dialog");
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(dialog?.parentElement).toBe(document.body);
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(document.activeElement).toBe(button("Close photograph"));
    expect(dialog?.textContent).toContain("Race photograph 3");
    expect(dialog?.textContent).toContain("3 of 3");
    expect(dialog?.querySelector("img")?.getAttribute("src")).toBe("/api/cms-media/media-3");

    key("ArrowLeft");
    expect(dialog?.textContent).toContain("Pit lane");
    expect(dialog?.textContent).toContain("2 of 3");
    click(button("Previous photograph")!);
    expect(dialog?.textContent).toContain("1 of 3");
    key("ArrowLeft");
    expect(dialog?.textContent).toContain("3 of 3");
    key("ArrowRight");
    expect(dialog?.textContent).toContain("1 of 3");
    click(button("Next photograph")!);
    expect(dialog?.textContent).toContain("Pit lane");

    const close = button("Close photograph")!;
    const next = button("Next photograph")!;
    next.focus();
    key("Tab");
    expect(document.activeElement).toBe(close);
    key("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(next);

    key("Escape");
    expect(document.querySelector("[data-gallery-lightbox]")).toBeNull();
    expect(document.activeElement).toBe(third);
    expect(document.body.style.overflow).toBe("scroll");
    expect(document.documentElement.style.overflow).toBe("auto");
  });

  it("hides navigation when the gallery has one photograph", () => {
    mounted.push(
      mount(
        createElement(MotorsportMediaGallery, {
          config: { heading: "Gallery", items: [photo(1)] },
        }),
      ),
    );
    click(button("View photograph 1 of 1: Race photograph 1")!);
    const dialog = document.querySelector("[data-gallery-lightbox]");
    expect(dialog?.textContent).toContain("1 of 1");
    expect(button("Previous photograph")).toBeNull();
    expect(button("Next photograph")).toBeNull();
    expect(button("Close photograph")).toBeTruthy();
    const close = button("Close photograph")!;
    close.focus();
    key("Tab");
    expect(document.activeElement).toBe(close);
    key("ArrowRight");
    expect(dialog?.textContent).toContain("1 of 1");
    expect(dialog?.querySelector("img")?.getAttribute("alt")).toBe("Race photograph 1");
    click(close);
    expect(document.querySelector("[data-gallery-lightbox]")).toBeNull();
  });
});
