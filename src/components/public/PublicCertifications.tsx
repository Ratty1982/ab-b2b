import {
  CERTIFICATION_HOMEPAGE_HEADING,
  CERTIFICATION_HOMEPAGE_SUPPORTING,
  type PublicCertification,
} from "@/domain/certifications";
import { cn } from "@/lib/utils";

function BadgeImage({
  cert,
  className,
  priority = false,
}: {
  cert: PublicCertification;
  className?: string;
  priority?: boolean;
}) {
  if (!cert.imageSrc) return null;
  const width = cert.imageWidth ?? 371;
  const height = cert.imageHeight ?? 175;
  return (
    <div
      className={cn(
        "inline-flex items-center justify-center rounded-md bg-white p-3 shadow-sm outline outline-1 -outline-offset-1 outline-border/50",
        className,
      )}
    >
      <img
        src={cert.imageSrc}
        alt={cert.imageAlt}
        width={width}
        height={height}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        className="h-auto max-h-28 w-auto max-w-full object-contain sm:max-h-32"
      />
    </div>
  );
}

export function HomepageCertificationsSection({
  certifications,
}: {
  certifications: PublicCertification[];
}) {
  const items = certifications.filter((item) => item.showOnHomepage && item.imageSrc);
  if (!items.length) return null;

  return (
    <section
      className="border-b border-border/60 bg-surface/20"
      aria-labelledby="homepage-certifications-heading"
      data-public-section="certifications"
    >
      <div className="mx-auto grid max-w-[1400px] items-center gap-8 px-4 py-14 sm:px-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:px-10">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-primary">
            Quality &amp; environment
          </div>
          <h2
            id="homepage-certifications-heading"
            className="mt-2 font-display text-3xl font-semibold uppercase leading-tight tracking-tight sm:text-4xl"
          >
            {CERTIFICATION_HOMEPAGE_HEADING}
          </h2>
          <p className="mt-4 max-w-2xl text-[14px] leading-relaxed text-steel">
            {CERTIFICATION_HOMEPAGE_SUPPORTING}
          </p>
          {items[0]?.certificatePdfUrl ? (
            <a
              href={items[0].certificatePdfUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-6 inline-flex h-11 items-center rounded-md border border-border bg-surface/50 px-5 text-sm font-semibold uppercase tracking-wide transition-colors hover:border-steel"
            >
              View Certificate
            </a>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-start gap-4 lg:justify-end">
          {items.map((cert) => (
            <figure key={cert.id} className="m-0">
              <BadgeImage cert={cert} priority />
              <figcaption className="sr-only">
                {cert.title} — {cert.issuingOrganisation}
                {cert.certificateNumber ? `, certificate ${cert.certificateNumber}` : ""}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

export function FooterCertifications({
  certifications,
}: {
  certifications: PublicCertification[];
}) {
  const items = certifications.filter((item) => item.showInFooter && item.imageSrc);
  if (!items.length) return null;

  return (
    <div className="mt-8 border-t border-border/50 pt-6" data-public-footer="certifications">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-steel">
        Accreditations
      </div>
      <ul className="mt-3 flex flex-wrap items-center gap-3">
        {items.map((cert) => (
          <li key={cert.id}>
            <a
              href={cert.certificatePdfUrl || "/why-automotive-brands#certifications"}
              {...(cert.certificatePdfUrl
                ? { target: "_blank", rel: "noreferrer" }
                : {})}
              className="inline-flex rounded-md bg-white/95 p-2 outline outline-1 -outline-offset-1 outline-border/40 transition-opacity hover:opacity-90"
              aria-label={cert.imageAlt}
            >
              <img
                src={cert.imageSrc!}
                alt=""
                width={cert.imageWidth ?? 371}
                height={cert.imageHeight ?? 175}
                loading="lazy"
                decoding="async"
                className="h-10 w-auto max-w-[160px] object-contain sm:h-11"
              />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AboutCertificationsSection({
  certifications,
}: {
  certifications: PublicCertification[];
}) {
  const items = certifications.filter((item) => item.showOnAboutPage);
  if (!items.length) return null;

  return (
    <section
      id="certifications"
      className="border-b border-border/60"
      aria-labelledby="about-certifications-heading"
      data-public-section="certifications-detail"
    >
      <div className="mx-auto max-w-[1400px] px-4 py-14 sm:px-6 lg:px-10">
        <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-primary">
          Certifications &amp; accreditations
        </div>
        <h2
          id="about-certifications-heading"
          className="mt-2 font-display text-3xl font-semibold uppercase tracking-tight"
        >
          Our certifications
        </h2>
        <div className="mt-8 grid gap-8 lg:grid-cols-2">
          {items.map((cert) => (
            <article
              key={cert.id}
              className="rounded-lg border border-border/70 bg-surface/30 p-6"
            >
              <div className="flex flex-wrap items-start gap-5">
                {cert.imageSrc ? <BadgeImage cert={cert} /> : null}
                <div className="min-w-0 flex-1">
                  <h3 className="font-display text-xl font-semibold uppercase tracking-tight">
                    {cert.title}
                  </h3>
                  <p className="mt-1 text-[13px] text-steel">{cert.issuingOrganisation}</p>
                  {cert.standards.length ? (
                    <ul className="mt-3 space-y-1 text-[13px] font-medium">
                      {cert.standards.map((standard) => (
                        <li key={standard}>{standard}</li>
                      ))}
                    </ul>
                  ) : null}
                  {cert.certificateNumber ? (
                    <p className="mt-3 text-[12px] text-steel">
                      Certificate number:{" "}
                      <span className="font-semibold text-foreground">{cert.certificateNumber}</span>
                    </p>
                  ) : null}
                  {(cert.issueDate || cert.expiryDate) && (
                    <p className="mt-1 text-[12px] text-steel">
                      {cert.issueDate ? `Issued ${cert.issueDate}` : null}
                      {cert.issueDate && cert.expiryDate ? " · " : null}
                      {cert.expiryDate ? `Valid until ${cert.expiryDate}` : null}
                    </p>
                  )}
                </div>
              </div>
              {cert.description ? (
                <p className="mt-4 text-[14px] leading-relaxed text-steel">{cert.description}</p>
              ) : null}
              {cert.scope ? (
                <p className="mt-2 text-[13px] text-steel">
                  <span className="font-semibold text-foreground">Scope:</span> {cert.scope}
                </p>
              ) : null}
              {cert.certificatePdfUrl ? (
                <a
                  href={cert.certificatePdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 inline-flex text-[13px] font-bold uppercase tracking-wide text-primary hover:underline"
                >
                  View Certificate
                </a>
              ) : null}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
