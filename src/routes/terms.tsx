import { createFileRoute, Link } from "@tanstack/react-router";
import { Footer } from "@/components/Footer";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service — AutopilotGEO" },
      {
        name: "description",
        content: "Terms of service for AutopilotGEO by AutoPilot Geo Ltd.",
      },
      { property: "og:title", content: "Terms of Service — AutopilotGEO" },
      { property: "og:description", content: "Terms of service for AutopilotGEO by AutoPilot Geo Ltd." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "https://autopilotgeo.com/terms" }],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Link to="/" className="font-display text-lg font-bold tracking-tight text-foreground">
            AutopilotGEO
          </Link>
          <nav className="flex items-center gap-4 text-[13px]">
            <Link to="/" className="text-muted-foreground hover:text-foreground">
              Home
            </Link>
            <Link to="/blog" className="text-muted-foreground hover:text-foreground">
              Blog
            </Link>
            <Link to="/auth" className="text-muted-foreground hover:text-foreground">
              Sign in
            </Link>
          </nav>
        </div>
      </div>

      <main className="mx-auto max-w-3xl px-5 py-12">
        <h1 className="font-display text-3xl font-bold sm:text-4xl">Terms of Service</h1>
        <p className="mt-2 text-[12px] text-muted-foreground">Last updated: {new Date().getFullYear()}</p>

        <div className="mt-8 space-y-6 text-[15px] leading-relaxed text-muted-foreground">
          <section>
            <h2 className="font-display text-lg font-semibold text-foreground">Agreement</h2>
            <p className="mt-2">
              These Terms of Service govern your use of AutopilotGEO, operated by AutoPilot Geo Ltd,
              Suite 4, Piccadilly House, Manchester, M1 1AB, United Kingdom. By signing up or using the
              service, you agree to these terms.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-semibold text-foreground">The service</h2>
            <p className="mt-2">
              AutopilotGEO provides AI-assisted content planning, writing, image generation and
              publishing to connected platforms. You are responsible for reviewing the content before it
              is published and for ensuring it complies with applicable laws and platform policies.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-semibold text-foreground">Subscriptions and billing</h2>
            <p className="mt-2">
              AutopilotGEO is offered as a subscription service. Fees are billed in advance. You may
              cancel at any time from your account settings. Annual plans are billed once per year and
              renew automatically unless cancelled.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-semibold text-foreground">Content and ownership</h2>
            <p className="mt-2">
              You retain ownership of the content generated for your account. You grant AutopilotGEO a
              limited licence to store, process and publish that content on your behalf through the
              integrations you enable.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-semibold text-foreground">Limitations</h2>
            <p className="mt-2">
              AutopilotGEO is provided “as is” without warranties of any kind. We are not liable for any
              indirect, incidental or consequential damages arising from the use of the service or from
              content published through it.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-semibold text-foreground">Changes and termination</h2>
            <p className="mt-2">
              We may update these terms from time to time. We will notify you of material changes. We may
              suspend or terminate accounts that violate these terms or harm the service or other users.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-semibold text-foreground">Contact</h2>
            <p className="mt-2">
              For questions about these terms, email{" "}
              <a href="mailto:support@autopilotgeo.com" className="text-primary hover:underline">
                support@autopilotgeo.com
              </a>
              .
            </p>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
