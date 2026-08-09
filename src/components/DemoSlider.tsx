import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import calendarShot from "@/assets/demo/calendar.jpg";
import researchShot from "@/assets/demo/research.jpg";
import platformsShot from "@/assets/demo/platforms.jpg";
import localShot from "@/assets/demo/local.jpg";

const SLIDES = [
  {
    src: calendarShot,
    label: "30-day calendar",
    title: "A rolling month of content, always full",
    text: "One piece per day, auto-rotating GEO, SEO, AEO, Local and Shopping. The window refills itself so you are never out of runway.",
  },
  {
    src: researchShot,
    label: "Keywords & rivals",
    title: "Real keyword and competitor data",
    text: "Live search volumes, difficulty and the pages your rivals rank with — fed straight into every brief.",
  },
  {
    src: platformsShot,
    label: "Destinations",
    title: "Publish anywhere you already sell",
    text: "WordPress, WooCommerce, PrestaShop, Shopify or your Lovable, Bolt and Replit site through a simple webhook.",
  },
  {
    src: localShot,
    label: "Local & Search",
    title: "Google Business Profile and Search Console",
    text: "Connect Google once to post local updates and steer the calendar with your real impressions and clicks.",
  },
] as const;

export function DemoSlider() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const go = useCallback((n: number) => setIndex((i) => (i + n + SLIDES.length) % SLIDES.length), []);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => go(1), 6000);
    return () => clearInterval(id);
  }, [paused, go]);

  const active = SLIDES[index]!;

  return (
    <section id="demo" className="border-b border-border bg-secondary/30">
      <div className="mx-auto max-w-6xl px-5 py-16 lg:py-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="font-mono text-[11px] font-semibold tracking-wide text-muted-foreground">
              PRODUCT TOUR
            </span>
            <h2 className="mt-2 font-display text-3xl font-bold">See the dashboard in action</h2>
            <p className="mt-2 max-w-xl text-[15px] text-muted-foreground">
              Real screens from a live workspace — calendar, research, destinations and Google.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              aria-label="Previous screen"
              onClick={() => go(-1)}
              className="grid size-10 place-items-center rounded-full border border-border bg-background transition-colors hover:border-gold hover:text-gold-foreground"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              aria-label="Next screen"
              onClick={() => go(1)}
              className="grid size-10 place-items-center rounded-full border border-border bg-background transition-colors hover:border-gold hover:text-gold-foreground"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>

        <div
          className="mt-8 grid gap-6 lg:grid-cols-[1.55fr_.95fr]"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          <div className="surface overflow-hidden p-2">
            <div className="flex items-center gap-1.5 px-2 pb-2 pt-1">
              <span className="size-2.5 rounded-full bg-destructive/60" />
              <span className="size-2.5 rounded-full bg-gold/70" />
              <span className="size-2.5 rounded-full bg-success/60" />
              <span className="ml-2 truncate font-mono text-[11px] text-muted-foreground">
                app.autopilotgeo.com/{active.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}
              </span>
            </div>
            <div className="relative overflow-hidden rounded-xl border border-border bg-background">
              <img
                key={active.label}
                src={active.src}
                alt={`${active.label} screen of the AutopilotGEO dashboard`}
                className="w-full animate-in fade-in duration-500"
              />
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {SLIDES.map((slide, i) => (
              <button
                key={slide.label}
                type="button"
                onClick={() => setIndex(i)}
                className={`rounded-xl border p-4 text-left transition-all ${
                  i === index
                    ? "border-gold bg-gold-soft/50 shadow-sm"
                    : "border-border bg-background hover:border-primary/40"
                }`}
              >
                <span className="font-mono text-[10px] font-semibold tracking-wide text-muted-foreground">
                  0{i + 1} · {slide.label.toUpperCase()}
                </span>
                <p className="mt-1 font-display text-[15px] font-semibold">{slide.title}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{slide.text}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 flex justify-center gap-2">
          {SLIDES.map((slide, i) => (
            <button
              key={slide.label}
              type="button"
              aria-label={`Show ${slide.label}`}
              onClick={() => setIndex(i)}
              className={`h-1.5 rounded-full transition-all ${
                i === index ? "w-8 bg-primary" : "w-3 bg-border hover:bg-primary/40"
              }`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
