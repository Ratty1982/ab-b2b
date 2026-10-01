import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge, type Tone } from "@/components/ab/Badges";
import { InstantText } from "@/components/ab/InstantText";
import { WhatsNewModal, type WhatsNewViewModel } from "@/components/system/WhatsNewModal";
import { ROUTES } from "@/lib/app-nav";
import { ensureAdminAccess } from "@/server/auth/route-guards";
import {
  archiveVersionUpdateFn,
  listVersionUpdatesAdminFn,
  previewVersionUpdateFn,
  publishVersionUpdateFn,
} from "@/server/phase2/fns";

export const Route = createFileRoute("/admin/version-updates/")({
  beforeLoad: async () => {
    const result = await ensureAdminAccess();
    if (!result.ok || !result.session.signedIn) throw redirect({ to: "/login" });
    if (!result.session.user.navPermissions.includes("version_updates.manage")) {
      throw redirect({ to: ROUTES.admin });
    }
  },
  head: () => ({ meta: [{ title: "Version Updates — Automotive Brands Admin" }] }),
  component: VersionUpdatesAdminPage,
});

type Row = Extract<
  Awaited<ReturnType<typeof listVersionUpdatesAdminFn>>,
  { ok: true }
>["data"][number];

function statusTone(status: string): Tone {
  if (status === "PUBLISHED") return "good";
  if (status === "DRAFT") return "warn";
  return "neutral";
}

function VersionUpdatesAdminPage() {
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<WhatsNewViewModel | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await listVersionUpdatesAdminFn({
      data: status ? { status } : {},
    });
    if (!res.ok) {
      setError(res.error);
      setRows([]);
      return;
    }
    setError(null);
    setRows(res.data);
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function publish(id: string) {
    setBusy(id);
    const res = await publishVersionUpdateFn({ data: { id } });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Published");
    await load();
  }

  async function archive(id: string) {
    setBusy(id);
    const res = await archiveVersionUpdateFn({ data: { id } });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Archived");
    await load();
  }

  async function previewRow(id: string) {
    const res = await previewVersionUpdateFn({ data: { id } });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setPreview(res.data);
  }

  return (
    <div>
      <PanelHeader
        title="Version Updates"
        sub="Publish What’s New for internal staff. Super Admin only."
        actions={
          <Link
            to={ROUTES.adminVersionUpdateNew}
            className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground"
          >
            Create Update
          </Link>
        }
      />

      <div className="space-y-4 p-4 sm:p-6">
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["", "All"],
              ["DRAFT", "Draft"],
              ["PUBLISHED", "Published"],
              ["ARCHIVED", "Archived"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={label}
              type="button"
              className={`h-9 rounded-md border px-3 text-[11px] font-semibold uppercase ${
                status === value
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-steel"
              }`}
              onClick={() => setStatus(value)}
            >
              {label}
            </button>
          ))}
        </div>

        {error ? <p className="text-[13px] text-bad">{error}</p> : null}

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[880px] text-[13px]">
            <thead>
              <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase text-steel">
                <th className="px-3 py-2">Version</th>
                <th className="px-3 py-2">Title</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Audience</th>
                <th className="px-3 py-2">Published</th>
                <th className="px-3 py-2">Created by</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-steel">
                    No version updates yet.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="border-b border-border/60">
                    <td className="num px-3 py-2 font-semibold text-primary">{row.version}</td>
                    <td className="px-3 py-2 font-medium">{row.title}</td>
                    <td className="px-3 py-2">
                      <StatusBadge tone={statusTone(row.status)}>{row.status}</StatusBadge>
                    </td>
                    <td className="px-3 py-2 text-steel">{row.audienceLabel}</td>
                    <td className="px-3 py-2 text-steel">
                      {row.publishedAt ? (
                        <InstantText value={row.publishedAt} variant="audit" />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2 text-steel">{row.createdByName ?? "—"}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          className="text-[11px] font-semibold uppercase text-primary"
                          onClick={() => void previewRow(row.id)}
                        >
                          Preview
                        </button>
                        <Link
                          to="/admin/version-updates/$id"
                          params={{ id: row.id }}
                          className="text-[11px] font-semibold uppercase text-primary"
                        >
                          Edit
                        </Link>
                        {row.status === "DRAFT" ? (
                          <button
                            type="button"
                            className="text-[11px] font-semibold uppercase text-primary disabled:opacity-40"
                            disabled={busy === row.id}
                            onClick={() => void publish(row.id)}
                          >
                            Publish
                          </button>
                        ) : null}
                        {row.status === "PUBLISHED" ? (
                          <button
                            type="button"
                            className="text-[11px] font-semibold uppercase text-steel disabled:opacity-40"
                            disabled={busy === row.id}
                            onClick={() => void archive(row.id)}
                          >
                            Archive
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <WhatsNewModal
        open={Boolean(preview)}
        update={preview}
        onAcknowledge={() => setPreview(null)}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      />
    </div>
  );
}
