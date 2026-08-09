import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { BrandLockup } from "@/components/BrandMark";
import { CalendarDays, Clock, ChevronLeft } from "lucide-react";
import { Footer } from "@/components/Footer";
import { BLOG_POSTS, getBlogPost } from "@/lib/blog";
import { renderMarkdown } from "@/lib/markdown";
import { getArticleBySlug, type IngestedArticle } from "@/lib/articles.functions";


export const Route = createFileRoute("/blog/$slug")({
  loader: async ({ params }) => {
    if (getBlogPost(params.slug)) return null;
    return (await getArticleBySlug({ data: { slug: params.slug } })) as IngestedArticle | null;
  },
  errorComponent: () => (
    <div className="mx-auto max-w-2xl px-5 py-24 text-center text-muted-foreground">
      This article could not be loaded.
    </div>
  ),
  notFoundComponent: () => (
    <div className="mx-auto max-w-2xl px-5 py-24 text-center text-muted-foreground">
      Article not found.
    </div>
  ),
  head: ({ params, loaderData }) => {
    const post = getBlogPost(params.slug);
    const article = (loaderData ?? null) as IngestedArticle | null;
    const title = post?.title ?? article?.title ?? null;
    const description = post?.description ?? article?.excerpt ?? null;
    const datePublished = post?.publishedAt ?? article?.published_at ?? null;
    const schema = title
      ? {
          "@context": "https://schema.org",
          "@type": "Article",
          headline: title,
          description: description ?? undefined,
          image: article?.cover_url ?? undefined,
          author: { "@type": "Organization", name: "Ranki.ai" },
          publisher: { "@type": "Organization", name: "Ranki.ai" },
          datePublished,
          dateModified: datePublished,
          mainEntityOfPage: {
            "@type": "WebPage",
            "@id": `https://www.ranki.ai/blog/${params.slug}`,
          },
        }
      : null;
    return {
      meta: [
        { title: title ? `${title} — Ranki.ai` : "Post — Ranki.ai" },
        {
          name: "description",
          content: description ?? "Read the full article on Ranki.ai.",
        },
        { property: "og:title", content: title ?? "Post — Ranki.ai" },
        {
          property: "og:description",
          content: description ?? "Read the full article on Ranki.ai.",
        },
        { property: "og:type", content: "article" },
        { name: "twitter:card", content: article?.cover_url ? "summary_large_image" : "summary" },
        ...(article?.cover_url
          ? [
              { property: "og:image", content: article.cover_url },
              { name: "twitter:image", content: article.cover_url },
            ]
          : []),
      ],
      links: [{ rel: "canonical", href: `https://www.ranki.ai/blog/${params.slug}` }],
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
  const article = Route.useLoaderData() as IngestedArticle | null;
  if (!post && !article) throw notFound();

  const related = BLOG_POSTS.filter((p) => p.slug !== slug).slice(0, 2);

  if (!post && article) {
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
              <Link to="/blog" className="font-semibold text-foreground">
                Blog
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
            <h1 className="font-display text-3xl font-bold leading-tight sm:text-4xl">
              {article.title}
            </h1>
            <div className="mt-4 flex items-center gap-1 text-[12px] text-muted-foreground">
              <CalendarDays className="size-3.5" />
              {new Date(article.published_at).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </div>
            {article.cover_url && (
              <img
                src={article.cover_url}
                alt={article.title}
                className="mt-6 w-full rounded-xl border border-border object-cover"
              />
            )}
            <div
              className="prose-magazine mt-8"
              dangerouslySetInnerHTML={{ __html: article.html ?? renderMarkdown(article.markdown ?? "") }}
            />
          </article>
        </main>
        <Footer />
      </div>
    );
  }

  if (!post) throw notFound();

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

      <Footer />
    </div>
  );
}

