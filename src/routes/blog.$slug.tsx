import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { CalendarDays, Clock, ChevronLeft } from "lucide-react";
import { Footer } from "@/components/Footer";
import { BLOG_POSTS, getBlogPost } from "@/lib/blog";


export const Route = createFileRoute("/blog/$slug")({
  head: ({ params }) => {
    const post = getBlogPost(params.slug);
    const schema = post
      ? {
          "@context": "https://schema.org",
          "@type": "Article",
          headline: post.title,
          description: post.description,
          author: { "@type": "Organization", name: "AutopilotGEO" },
          publisher: { "@type": "Organization", name: "AutopilotGEO" },
          datePublished: post.publishedAt,
          dateModified: post.publishedAt,
          mainEntityOfPage: {
            "@type": "WebPage",
            "@id": `https://autopilotgeo.com/blog/${post.slug}`,
          },
        }
      : null;
    return {
      meta: [
        { title: post ? `${post.title} — AutopilotGEO` : "Post — AutopilotGEO" },
        {
          name: "description",
          content: post?.description ?? "Read the full article on AutopilotGEO.",
        },
        { property: "og:title", content: post?.title ?? "Post — AutopilotGEO" },
        {
          property: "og:description",
          content: post?.description ?? "Read the full article on AutopilotGEO.",
        },
        { property: "og:type", content: "article" },
        { name: "twitter:card", content: "summary" },
      ],
      links: [{ rel: "canonical", href: `/blog/${params.slug}` }],
      scripts: schema
        ? [
            {
              type: "application/ld+json",
              children: JSON.stringify(schema),
            },
          ]
        : undefined,

    };
  },
  component: BlogPost,
});


function BlogPost() {
  const { slug } = Route.useParams();
  const post = getBlogPost(slug);
  if (!post) throw notFound();

  const related = BLOG_POSTS.filter((p) => p.slug !== slug).slice(0, 2);

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
            <Link to="/blog" className="font-semibold text-foreground">
              Blog
            </Link>
            <Link to="/auth" className="text-muted-foreground hover:text-foreground">
              Sign in
            </Link>
          </nav>
        </div>
      </div>

      <main className="mx-auto max-w-3xl px-5 py-12">
        <Link
          to="/blog"
          className="inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" /> All articles
        </Link>

        <article className="mt-6">
          <div className="flex flex-wrap gap-2">
            {post.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium text-secondary-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
          <h1 className="mt-4 font-display text-3xl font-bold leading-tight sm:text-4xl">{post.title}</h1>
          <div className="mt-4 flex flex-wrap items-center gap-4 text-[12px] text-muted-foreground">
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
            <span>By {post.author}</span>
          </div>

          <div className="prose-magazine mt-8">
            {post.content.map((block, i) => {
              if (block.type === "h2") {
                return <h2 key={i}>{block.text}</h2>;
              }
              if (block.type === "h3") {
                return <h3 key={i}>{block.text}</h3>;
              }
              if (block.type === "ul") {
                return (
                  <ul key={i}>
                    {block.items?.map((item, j) => (
                      <li key={j}>{item}</li>
                    ))}
                  </ul>
                );
              }
              return <p key={i}>{block.text}</p>;
            })}
          </div>
        </article>

        {related.length > 0 && (
          <section className="mt-12 border-t border-border pt-8">
            <h2 className="font-display text-lg font-semibold">Read next</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {related.map((r) => (
                <Link
                  key={r.slug}
                  to="/blog/$slug"
                  params={{ slug: r.slug }}
                  className="surface block p-4 transition-all hover:border-primary/40 hover:shadow-sm"
                >
                  <p className="font-display font-semibold">{r.title}</p>
                  <p className="mt-1 text-[12px] text-muted-foreground">{r.description}</p>
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-[12px] text-muted-foreground">
          <span>© {new Date().getFullYear()} AutopilotGEO</span>
          <Link to="/" className="hover:text-foreground">
            Back to home
          </Link>
        </div>
      </footer>
    </div>
  );
}
