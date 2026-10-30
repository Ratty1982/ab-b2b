import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicLayout, PublicPageBreadcrumbs } from "@/components/ab/PublicLayout";

/**
 * Published prize-draw terms. Legal wording is preserved from the supplied
 * document. Review notes, not silent rewrites:
 * - Section 1 uses “Brickyard lane”; section 11 uses “Brickyard Lane”.
 * - “14 Days” is capitalised in section 6 and lower case elsewhere.
 * - The survey privacy note says “Automotive Brands Ltd”. These terms say
 *   “Steel Seal Ltd t/a Automotive Brands”.
 * - No approved privacy policy is in the repository or CMS. The link is the
 *   path /privacy-policy and stays unresolved until legal supplies the page.
 * - The original HTML used target="blank", which is not a valid target.
 */
export const Route = createFileRoute("/free-prize-draw-terms-conditions")({
  head: () => ({
    meta: [
      { title: "Free Prize Draw Terms & Conditions — Automotive Brands" },
      {
        name: "description",
        content:
          "Terms and conditions for the Automotive Brands free prize draw, promoted by Steel Seal Ltd.",
      },
    ],
  }),
  component: PrizeDrawTermsPage,
});

function PrizeDrawTermsPage() {
  return (
    <PublicLayout>
      <PublicPageBreadcrumbs
        items={[{ label: "Home", to: "/" }, { label: "Free Prize Draw Terms" }]}
      />
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <header className="rounded-xl bg-neutral-950 px-6 py-10 text-center text-white">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-300">
            Terms & Conditions
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold">Free Prize Draw</h1>
        </header>
        <article className="mt-6 rounded-xl border border-border bg-card px-5 py-6 text-sm leading-6 text-foreground sm:px-8 sm:py-8">
          <p className="border-l-4 border-neutral-950 bg-muted px-4 py-3 text-[13px] text-muted-foreground">
            Please read these Terms & Conditions carefully before entering the prize draw. By
            entering, you agree to be bound by them.
          </p>

          <h2 className="mt-6 border-b border-border pb-1 text-base font-semibold">1. Promoter</h2>
          <p className="mt-3">
            The promoter of this free prize draw is Steel Seal Ltd t/a Automotive Brands,{" "}
            <strong>Brickyard lane, Studley, B80 7EE</strong>, company number{" "}
            <strong>07421424</strong> (“the Promoter”).
          </p>

          <h2 className="mt-6 border-b border-border pb-1 text-base font-semibold">
            2. Eligibility
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              The prize draw is open to residents of the United Kingdom aged 18 or over, except
              employees of the Promoter, their immediate family members, agents, or anyone else
              connected with the administration of the prize draw.
            </li>
            <li>
              Entry is limited to one per person / per business. Multiple entries will be
              disqualified.
            </li>
            <li>The Promoter reserves the right to require proof of identity and eligibility.</li>
          </ul>

          <h2 className="mt-6 border-b border-border pb-1 text-base font-semibold">
            3. How to enter
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              To enter, complete the Automotive Brands Customer Satisfaction Survey available at{" "}
              <Link to="/customer-survey" className="font-semibold underline">
                automotivebrands.co.uk/customer-survey/
              </Link>{" "}
              and select the option to enter the free prize draw when prompted.
            </li>
            <li>
              You must provide a valid name and email address (and telephone number if requested) so
              that we can administer the prize draw.
            </li>
            <li>No purchase is necessary. Entry is free.</li>
            <li>Incomplete, illegible, or fraudulent entries will be disqualified.</li>
          </ul>

          <h2 className="mt-6 border-b border-border pb-1 text-base font-semibold">
            4. Opening and closing dates
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              The prize draw opens at <strong>00:01 on 01/11/2026</strong> and closes at{" "}
              <strong>23:59 on 31/01/2027</strong>.
            </li>
            <li>Entries received after the closing date will not be accepted.</li>
            <li>
              The Promoter accepts no responsibility for entries that are lost, delayed, incomplete,
              or not received for any reason.
            </li>
          </ul>

          <h2 className="mt-6 border-b border-border pb-1 text-base font-semibold">5. The Prize</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              There is <strong>one top prize</strong> consisting of{" "}
              <strong>A free overnight stay and meal for two at The </strong>
              <a
                href="https://thepistonclub.co.uk/"
                className="font-semibold underline"
                rel="noreferrer"
              >
                Piston Club
              </a>
              .
            </li>
            <li>
              There are also <strong>two runner up prizes</strong> consisting of{" "}
              <strong>a Power Maxed Valeting Bucket (or product to the same value)</strong>.
            </li>
            <li>
              The prize is non-transferable, non-exchangeable, and no cash alternative will be
              offered, except at the Promoter’s sole discretion.
            </li>
            <li>
              The Promoter reserves the right to substitute the prize with one of equal or greater
              value if circumstances beyond its control make this necessary.
            </li>
          </ul>

          <h2 className="mt-6 border-b border-border pb-1 text-base font-semibold">
            6. Winner selection
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              The winner(s) will be selected at random from all valid entries received by the
              closing date.
            </li>
            <li>
              The draw will take place within <strong>14 Days</strong> of the closing date under the
              supervision of an independent person (or by a verifiable random process).
            </li>
            <li>The Promoter’s decision is final and no correspondence will be entered into.</li>
          </ul>

          <h2 className="mt-6 border-b border-border pb-1 text-base font-semibold">
            7. Winner notification
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              The winner(s) will be notified by email (and/or telephone) within{" "}
              <strong>7 days</strong> of the draw using the contact details provided on entry.
            </li>
            <li>
              If a winner does not respond within <strong>14 days</strong> of notification, or is
              found to be ineligible, the Promoter reserves the right to select an alternative
              winner.
            </li>
            <li>
              The prize will be delivered within <strong>28 days</strong> of the winner confirming
              acceptance and providing any necessary delivery details.
            </li>
          </ul>

          <h2 className="mt-6 border-b border-border pb-1 text-base font-semibold">8. Publicity</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              By entering, winners agree that the Promoter may use their name and county/town of
              residence for promotional purposes (including announcing the winner on the Promoter’s
              website or social media) without further compensation, unless the winner objects.
            </li>
            <li>
              Winners may be asked to participate in reasonable publicity, but this is not a
              condition of receiving the prize.
            </li>
          </ul>

          <h2 className="mt-6 border-b border-border pb-1 text-base font-semibold">
            9. Data protection
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              Personal data supplied in connection with the prize draw will be used by the Promoter
              solely for the purposes of administering the prize draw and (where consent has been
              given) for related customer communication.
            </li>
            <li>
              Data will be processed in accordance with the Promoter’s Privacy Policy (available at{" "}
              <a
                href="/privacy-policy"
                className="font-semibold underline"
              >
                Privacy Policy
              </a>
              ) and applicable data protection legislation, including the UK GDPR and Data
              Protection Act 2018.
            </li>
            <li>
              Personal data will not be shared with third parties except as necessary to administer
              the prize or where required by law.
            </li>
          </ul>

          <h2 className="mt-6 border-b border-border pb-1 text-base font-semibold">10. General</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              The Promoter reserves the right to cancel, suspend, or amend the prize draw or these
              Terms & Conditions where it becomes necessary to do so due to circumstances outside
              its reasonable control, without prior notice.
            </li>
            <li>
              The Promoter accepts no responsibility for any damage, loss, injury, or disappointment
              suffered by any entrant as a result of entering the prize draw or accepting a prize,
              except for any liability that cannot be excluded by law (including death or personal
              injury caused by negligence).
            </li>
            <li>
              These Terms & Conditions are governed by the laws of England and Wales. Any disputes
              will be subject to the exclusive jurisdiction of the courts of England and Wales.
            </li>
            <li>By entering the prize draw, you agree to be bound by these Terms & Conditions.</li>
          </ul>

          <h2 className="mt-6 border-b border-border pb-1 text-base font-semibold">11. Contact</h2>
          <p className="mt-3">
            For any queries regarding the prize draw, please contact:
            <br />
            <strong>info@automotivebrands.co.uk</strong>
            <br />
            Steel Seal Ltd t/a Automotive Brands
            <br />
            <strong>Brickyard Lane, Studley, B80 7EE</strong>
          </p>
        </article>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Steel Seal Ltd t/a Automotive Brands
          <br />
          <Link
            to="/"
            className="mt-2 inline-flex min-h-11 items-center font-semibold text-foreground underline"
          >
            Return to Automotive Brands
          </Link>
        </p>
      </main>
    </PublicLayout>
  );
}
