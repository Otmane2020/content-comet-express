import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarDays, Clock } from "lucide-react";
import { Footer } from "@/components/Footer";
import { BLOG_POSTS } from "@/lib/blog";
import { listArticles } from "@/lib/articles.functions";


export const Route = createFileRoute("/blog/")({
  loader: () => listArticles(),
  errorComponent: () => (
    <div className="mx-auto max-w-2xl px-5 py-24 text-center text-muted-foreground">
      Articles could not be loaded. Please refresh.
    </div>
  ),
  notFoundComponent: () => (
    <div className="mx-auto max-w-2xl px-5 py-24 text-center text-muted-foreground">
      Nothing here.
    </div>
  ),
  head: () => {
    const schema = {
      "@context": "https://schema.org",
      "@type": "Blog",
      name: "AutopilotGEO Blog",
      description: "Guides on GEO, AI content automation, local SEO and Google Business Profile.",
      url: "https://autopilotgeo.com/blog",
      blogPost: BLOG_POSTS.map((post) => ({
        "@type": "BlogPosting",
        headline: post.title,
        url: `https://autopilotgeo.com/blog/${post.slug}`,
        datePublished: post.publishedAt,
      })),
    };
    return {
      meta: [
        { title: "Blog — AutopilotGEO" },
        {
          name: "description",
          content:
            "Guides on GEO, AI content automation, local SEO and Google Business Profile. Practical advice for founders and marketers.",
        },
        { property: "og:title", content: "Blog — AutopilotGEO" },
        {
          property: "og:description",
          content: "Guides on GEO, AI content automation, local SEO and Google Business Profile.",
        },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
      ],
      links: [{ rel: "canonical", href: "https://autopilotgeo.com/blog" }],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify(schema),
        },
      ],

    };
  },
  component: BlogIndex,
});


function BlogIndex() {
  const articles = Route.useLoaderData();
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
            <span className="font-semibold text-foreground">Blog</span>
            <Link to="/auth" className="text-muted-foreground hover:text-foreground">
              Sign in
            </Link>
          </nav>
        </div>
      </div>

      <main className="mx-auto max-w-6xl px-5 py-12">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="font-display text-3xl font-bold sm:text-4xl">AutopilotGEO Blog</h1>
          <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
            Practical guides on GEO, AI content automation, local SEO and Google Business Profile.
          </p>
        </div>

        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {articles.map((post) => (
            <article
              key={post.slug}
              className="surface group flex flex-col overflow-hidden transition-all hover:border-primary/40 hover:shadow-sm"
            >
              {post.cover_url && (
                <img
                  src={post.cover_url}
                  alt={post.title}
                  loading="lazy"
                  className="h-40 w-full object-cover"
                />
              )}
              <div className="flex flex-1 flex-col p-5">
                {post.content_type && (
                  <span className="w-fit rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium uppercase text-secondary-foreground">
                    {post.content_type}
                  </span>
                )}
                <h2 className="mt-3 font-display text-lg font-semibold leading-snug group-hover:text-primary">
                  <Link to="/blog/$slug" params={{ slug: post.slug }}>
                    {post.title}
                  </Link>
                </h2>
                <p className="mt-2 flex-1 text-[13px] leading-relaxed text-muted-foreground">
                  {post.excerpt}
                </p>
                <div className="mt-4 flex items-center gap-1 text-[11px] text-muted-foreground">
                  <CalendarDays className="size-3.5" />
                  {new Date(post.published_at).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </div>
              </div>
            </article>
          ))}
          {BLOG_POSTS.map((post) => (
            <article
              key={post.slug}
              className="surface group flex flex-col p-5 transition-all hover:border-primary/40 hover:shadow-sm"
            >
              <div className="flex flex-wrap gap-2">
                {post.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <h2 className="mt-3 font-display text-lg font-semibold leading-snug group-hover:text-primary">
                <Link to="/blog/$slug" params={{ slug: post.slug }}>
                  {post.title}
                </Link>
              </h2>
              <p className="mt-2 flex-1 text-[13px] leading-relaxed text-muted-foreground">
                {post.description}
              </p>
              <div className="mt-4 flex items-center gap-4 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <CalendarDays className="size-3.5" />
                  {new Date(post.publishedAt).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="size-3.5" /> {post.readMinutes} min read
                </span>
              </div>
            </article>
          ))}
        </div>
      </main>

      <Footer />
    </div>
  );
}

