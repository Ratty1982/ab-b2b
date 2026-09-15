import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { Field, inputClass } from "@/components/ab/Drawer";
import { brands } from "@/lib/data";
import { news } from "@/lib/crm-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/content")({
  head: () => ({
    meta: [
      { title: "Website Content & Downloads — Automotive Brands Admin" },
      {
        name: "description",
        content:
          "Manage homepage content, hero banners, brand pages, navigation, featured products, promotions, downloads and trade resources.",
      },
      { property: "og:title", content: "Website Content & Downloads — Automotive Brands Admin" },
      { property: "og:description", content: "Content management for the public site and trade resources." },
    ],
  }),
  component: AdminContent,
});

const pages = [
  { name: "Homepage", path: "/", updated: "Today, 10:12", status: "Published" },
  { name: "Products", path: "/products", updated: "11 Sep 2026", status: "Published" },
  { name: "Trade Solutions", path: "/trade-solutions", updated: "04 Sep 2026", status: "Published" },
  { name: "Why Automotive Brands", path: "/why-automotive-brands", updated: "28 Aug 2026", status: "Published" },
  { name: "Resources", path: "/resources", updated: "21 Aug 2026", status: "Published" },
  { name: "About Us", path: "/about", updated: "12 Aug 2026", status: "Published" },
  { name: "Contact", path: "/contact", updated: "12 Aug 2026", status: "Draft" },
];

const downloads = [
  { name: "Power Maxed braking catalogue 2026", type: "PDF", size: "8.4 MB", access: "Public" },
  { name: "Steel Seal safety data sheet — 300ml", type: "PDF", size: "210 KB", access: "Public" },
  { name: "Street Rhino wheel fitment guide", type: "PDF", size: "3.1 MB", access: "Public" },
  { name: "Trade price list — Trade A", type: "XLSX", size: "640 KB", access: "Trade login" },
  { name: "Marketing imagery pack — all brands", type: "ZIP", size: "142 MB", access: "Trade login" },
];

function AdminContent() {
  const [tab, setTab] = useState<"Pages" | "Homepage" | "Brand pages" | "News" | "Downloads">("Pages");

  return (
    <div>
      <PanelHeader
        title="Website content"
        sub="Homepage, brand pages, navigation, promotions, downloads and trade resources"
        actions={
          <button
            type="button"
            className="h-10 rounded-md bg-primary px-5 text-[13px] font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110"
          >
            Publish changes
          </button>
        }
      />

      <div className="flex gap-1 overflow-x-auto border-b border-border/70 px-4 sm:px-6">
        {(["Pages", "Homepage", "Brand pages", "News", "Downloads"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-current={tab === t ? "page" : undefined}
            className={cn(
              "shrink-0 border-b-2 px-3 py-3 text-[13px] font-semibold",
              tab === t ? "border-primary text-foreground" : "border-transparent text-steel hover:text-foreground",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="p-4 sm:p-6">
        {tab === "Pages" ? (
          <Table
            head={["Page", "Path", "Last updated", "Status", ""]}
            rows={pages.map((p) => [
              p.name,
              p.path,
              p.updated,
              <StatusBadge key={p.path} tone={p.status === "Published" ? "good" : "warn"}>
                {p.status}
              </StatusBadge>,
              "Edit",
            ])}
          />
        ) : tab === "Homepage" ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-4">
              <h2 className="font-display text-lg font-semibold uppercase">Hero</h2>
              <Field label="Headline">
                <input className={inputClass} defaultValue="The brands behind the automotive aftermarket." />
              </Field>
              <Field label="Supporting copy">
                <textarea
                  rows={3}
                  className={inputClass}
                  defaultValue="Automotive Brands supplies trusted automotive products to motor factors, retailers, workshops, garages and distributors across the UK."
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Primary call to action">
                  <input className={inputClass} defaultValue="Open a trade account" />
                </Field>
                <Field label="Secondary call to action">
                  <input className={inputClass} defaultValue="Explore our brands" />
                </Field>
              </div>
              <Field label="Hero image">
                <select className={inputClass}>
                  <option>hero-parts.jpg — workshop parts array</option>
                  <option>warehouse.jpg — distribution centre</option>
                  <option>trade-counter.jpg — motor factor counter</option>
                </select>
              </Field>
            </div>
            <div className="space-y-4">
              <h2 className="font-display text-lg font-semibold uppercase">Homepage sections</h2>
              <ul className="divide-y divide-border rounded-lg border border-border text-[13px]">
                {[
                  "Brand showcase",
                  "Product categories",
                  "Featured ranges",
                  "New products",
                  "Best sellers",
                  "Why trade customers choose us",
                  "Trade customer types",
                  "Distribution & service",
                  "Trade resources",
                  "Latest news",
                  "Open a trade account",
                ].map((s, i) => (
                  <li key={s} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5">
                    <span className="num text-steel">{i + 1}</span>
                    <span className="min-w-0 truncate">{s}</span>
                    <label className="flex items-center gap-2 text-[12px] text-steel">
                      <input type="checkbox" defaultChecked className="accent-primary" />
                      Visible
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : tab === "Brand pages" ? (
          <Table
            head={["Brand", "Page", "Hero image", "Status", ""]}
            rows={brands.map((b) => [b.name, `/brands/${b.slug}`, `${b.slug}-hero.jpg`, <StatusBadge key={b.slug} tone="good">Published</StatusBadge>, "Edit"])}
          />
        ) : tab === "News" ? (
          <Table
            head={["Article", "Date", "Category", "Status", ""]}
            rows={news.map((n) => [n.title, n.date, n.category, <StatusBadge key={n.title} tone="good">Published</StatusBadge>, "Edit"])}
          />
        ) : (
          <Table
            head={["Download", "Type", "Size", "Access", ""]}
            rows={downloads.map((d) => [
              d.name,
              d.type,
              d.size,
              <StatusBadge key={d.name} tone={d.access === "Public" ? "neutral" : "brand"}>
                {d.access}
              </StatusBadge>,
              "Replace",
            ])}
          />
        )}
      </div>
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[720px] text-[13px]">
        <thead>
          <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
            {head.map((h, i) => (
              <th key={i} className={cn("px-3 py-2 font-semibold", i === head.length - 1 && "text-right")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={cn("border-b border-border/60 last:border-0", i % 2 && "bg-surface/30")}>
              {r.map((c, ci) => (
                <td
                  key={ci}
                  className={cn(
                    "px-3 py-2.5",
                    ci === 0 && "font-medium",
                    ci === r.length - 1 && "text-right",
                  )}
                >
                  {ci === r.length - 1 ? (
                    <button type="button" className="text-[12px] font-semibold text-primary hover:underline">
                      {c}
                    </button>
                  ) : (
                    c
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
