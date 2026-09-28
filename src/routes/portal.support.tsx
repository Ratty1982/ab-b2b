import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Mail, Phone, Smartphone } from "lucide-react";
import { PanelHeader } from "@/components/ab/AppShell";
import { getPortalSupportContactFn } from "@/server/phase2/fns";
import { ROUTES } from "@/lib/app-nav";
import {
  ACCOUNT_MANAGER_HOURS,
  ACCOUNT_MANAGER_HOURS_LINES,
} from "@/domain/account-manager-hours";
import type { AccountManagerPublic } from "@/server/sales/account-manager";

export const Route = createFileRoute("/portal/support")({
  head: () => ({
    meta: [
      { title: "Support — Automotive Brands Trade Portal" },
      {
        name: "description",
        content: "Contact your account manager or Automotive Brands trade support.",
      },
    ],
  }),
  component: Support,
});

function Support() {
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [manager, setManager] = useState<AccountManagerPublic | null>(null);
  const [generalMailto, setGeneralMailto] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const r = await getPortalSupportContactFn();
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setCompanyName(r.data.companyName);
      setManager(r.data.accountManager);
      setGeneralMailto(r.data.generalContact?.mailtoHref ?? null);
    })();
  }, []);

  return (
    <div>
      <PanelHeader
        title="Support"
        sub={companyName ? `Trade account · ${companyName}` : "Trade account"}
      />
      <div className="grid gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="rounded-lg border border-border bg-surface/40 p-5">
          <h2 className="font-display text-lg font-semibold uppercase tracking-tight">
            How can we help?
          </h2>
          <p className="mt-2 text-[13px] text-steel">
            Use your account manager contact when assigned, or continue shopping while we expand
            in-portal messaging.
          </p>
          {error ? <p className="mt-3 text-[13px] text-bad">{error}</p> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              to={ROUTES.products}
              className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground"
            >
              Shop products
            </Link>
            <Link
              to={ROUTES.portalOrders}
              className="inline-flex h-10 items-center rounded-md border border-border px-4 text-[12px] font-bold uppercase hover:border-steel"
            >
              View orders
            </Link>
          </div>
        </section>

        <aside className="space-y-4">
          <div className="rounded-lg border border-border bg-surface/50 p-4">
            <div className="text-[11px] uppercase tracking-[0.16em] text-steel">Account manager</div>
            {manager ? (
              <>
                <div className="mt-2 flex items-start gap-3">
                  {manager.photo ? (
                    <img
                      src={manager.photo.src}
                      alt={manager.photo.alt}
                      className="size-12 shrink-0 rounded-full object-cover"
                      style={{ objectPosition: manager.photo.objectPosition }}
                    />
                  ) : (
                    <div
                      className="grid size-12 shrink-0 place-items-center rounded-full bg-ink font-display text-xs font-semibold"
                      aria-hidden
                    >
                      {manager.initials}
                    </div>
                  )}
                  <div>
                    <div className="font-display text-lg font-semibold uppercase leading-tight">
                      {manager.name}
                    </div>
                    <div className="text-[12px] text-steel">{manager.jobTitle}</div>
                  </div>
                </div>
                <ul className="mt-3 space-y-1.5 text-[13px]">
                  {manager.email ? (
                    <li className="flex min-w-0 items-center gap-2">
                      <Mail className="size-3.5 shrink-0 text-primary" aria-hidden />
                      <a href={manager.mailtoHref ?? undefined} className="truncate hover:underline">
                        {manager.email}
                      </a>
                    </li>
                  ) : null}
                  {manager.phone ? (
                    <li className="flex min-w-0 items-center gap-2">
                      <Phone className="size-3.5 shrink-0 text-primary" aria-hidden />
                      <a href={manager.telHref ?? undefined} className="truncate hover:underline">
                        {manager.phone}
                      </a>
                    </li>
                  ) : null}
                  {manager.mobile ? (
                    <li className="flex min-w-0 items-center gap-2">
                      <Smartphone className="size-3.5 shrink-0 text-primary" aria-hidden />
                      <a
                        href={manager.mobileTelHref ?? undefined}
                        className="truncate hover:underline"
                      >
                        {manager.mobile}
                      </a>
                    </li>
                  ) : null}
                </ul>
                {manager.primaryContactHref ? (
                  <a
                    href={manager.primaryContactHref}
                    className="mt-4 grid h-10 place-items-center rounded-md bg-primary text-[13px] font-bold text-primary-foreground"
                  >
                    {manager.primaryContactLabel ?? "Contact account manager"}
                  </a>
                ) : generalMailto ? (
                  <a
                    href={generalMailto}
                    className="mt-4 grid h-10 place-items-center rounded-md bg-primary text-[13px] font-bold text-primary-foreground"
                  >
                    Contact Automotive Brands
                  </a>
                ) : null}
              </>
            ) : (
              <>
                <p className="mt-2 text-[13px] text-steel">Our trade team is here to help.</p>
                {generalMailto ? (
                  <a
                    href={generalMailto}
                    className="mt-4 grid h-10 place-items-center rounded-md bg-primary text-[13px] font-bold text-primary-foreground"
                  >
                    Contact Automotive Brands
                  </a>
                ) : null}
              </>
            )}
          </div>
          <div className="rounded-lg border border-border bg-surface/50 p-4 text-[13px]">
            <div className="text-[11px] uppercase tracking-[0.16em] text-steel">
              {ACCOUNT_MANAGER_HOURS.heading}
            </div>
            <ul className="mt-2 space-y-1 text-steel">
              {ACCOUNT_MANAGER_HOURS_LINES.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
