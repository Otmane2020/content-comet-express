import { createFileRoute, Link } from "@tanstack/react-router";
import { Footer } from "@/components/Footer";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — Ranki.ai" },
      {
        name: "description",
        content: "Privacy policy for Ranki.ai by Ranki AI Ltd.",
      },
      { property: "og:title", content: "Privacy Policy — Ranki.ai" },
      { property: "og:description", content: "Privacy policy for Ranki.ai by Ranki AI Ltd." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "https://www.ranki.ai/privacy" }],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Link to="/" className="font-display text-lg font-bold tracking-tight text-foreground">
            Ranki.ai
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
        <h1 className="font-display text-3xl font-bold sm:text-4xl">Privacy Policy</h1>
        <p className="mt-2 text-[12px] text-muted-foreground">Last updated: {new Date().getFullYear()}</p>

        <div className="mt-8 space-y-6 text-[15px] leading-relaxed text-muted-foreground">
          <section>
            <h2 className="font-display text-lg font-semibold text-foreground">Who we are</h2>
            <p className="mt-2">
              Ranki.ai is operated by Ranki AI Ltd, Suite 4, Piccadilly House, Manchester, M1
              1AB, United Kingdom. If you have questions about this policy, email us at{" "}
              <a href="mailto:support@ranki.ai" className="text-primary hover:underline">
                support@ranki.ai
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-semibold text-foreground">What we collect</h2>
            <p className="mt-2">
              We collect the information you provide when you sign up, connect integrations or contact
              support: name, email, business details, platform credentials and payment information. We
              also collect usage data and cookies to keep the service secure and improve the product.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-semibold text-foreground">How we use data</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>To provide and maintain the Ranki.ai service.</li>
              <li>To generate, publish and schedule content on your connected platforms.</li>
              <li>To process payments and send account-related emails.</li>
              <li>To analyse usage and improve features.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-lg font-semibold text-foreground">Data sharing</h2>
            <p className="mt-2">
              We do not sell your personal data. We share data only with service providers necessary to
              run Ranki.ai (hosting, AI providers, payment processors) and only when required by law.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-semibold text-foreground">Your rights</h2>
            <p className="mt-2">
              You can access, correct or delete your account data at any time from the dashboard or by
              contacting us. You may also object to certain processing or request a copy of your data.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-semibold text-foreground">Security</h2>
            <p className="mt-2">
              We use encryption in transit and at rest, role-based access and regular security reviews.
              Platform credentials are stored encrypted and never displayed in plain text.
            </p>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
