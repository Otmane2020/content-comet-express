import { createFileRoute, Link } from "@tanstack/react-router";
import { BrandLockup } from "@/components/BrandMark";
import { Footer } from "@/components/Footer";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About us — Ranki.ai" },
      {
        name: "description",
        content:
          "Ranki AI Ltd builds Ranki.ai, a 30-day AI content engine that plans, writes and publishes GEO, SEO and local content.",
      },
      { property: "og:title", content: "About us — Ranki.ai" },
      {
        property: "og:description",
        content: "Ranki AI Ltd builds Ranki.ai, a 30-day AI content engine.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "https://www.ranki.ai/about" }],
  }),
  component: AboutPage,
});

function AboutPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Link to="/" aria-label="Ranki.ai home">
            <BrandLockup />
          </Link>
          <nav className="flex items-center gap-4 text-[13px]">
            <Link to="/" className="text-muted-foreground hover:text-foreground">
              Home
            </Link>
            <Link to="/blog" className="text-muted-foreground hover:text-foreground">
              Blog
            </Link>
            <span className="font-semibold text-foreground">About us</span>
            <Link to="/auth" className="text-muted-foreground hover:text-foreground">
              Sign in
            </Link>
          </nav>
        </div>
      </div>

      <main className="mx-auto max-w-3xl px-5 py-12">
        <h1 className="font-display text-3xl font-bold sm:text-4xl">About us</h1>
        <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
          Ranki.ai is built by Ranki AI Ltd, a small company in Manchester focused on making
          generative-search content simple for busy founders and marketers.
        </p>

        <section className="mt-10">
          <h2 className="font-display text-xl font-semibold">What we do</h2>
          <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
            We run a rolling 30-day content engine. You connect your site, describe your business and
            choose your tone. Ranki.ai then researches keywords and competitors, plans a calendar,
            writes articles with AI-generated images and publishes them automatically to your CMS, blog
            or Google Business Profile.
          </p>
        </section>

        <section className="mt-8">
          <h2 className="font-display text-xl font-semibold">Company details</h2>
          <div className="mt-3 rounded-lg border border-border bg-card p-5 text-[14px] leading-relaxed text-card-foreground">
            <p className="font-semibold">Ranki AI Ltd</p>
            <p>Suite 4, Piccadilly House</p>
            <p>Manchester, M1 1AB</p>
            <p>United Kingdom</p>
            <p className="mt-2">
              Email:{" "}
              <a href="mailto:support@ranki.ai" className="text-primary hover:underline">
                support@ranki.ai
              </a>
            </p>
          </div>
        </section>

        <section className="mt-8">
          <h2 className="font-display text-xl font-semibold">Our approach</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-muted-foreground">
            <li>Human-first strategy, machine execution.</li>
            <li>Every article is factual, cited where possible and tailored to your business.</li>
            <li>Images are generated without text or logos so they stay clean and reusable.</li>
            <li>You review, edit or pause anything before it goes live.</li>
          </ul>
        </section>
      </main>

      <Footer />
    </div>
  );
}
