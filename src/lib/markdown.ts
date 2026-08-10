/** Minimal markdown -> HTML for generated articles (headings, lists, bold, links). */
export function renderMarkdown(md: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" rel="noopener">$1</a>');

  const out: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };

  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      closeList();
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    const image = /^!\[(.*?)\]\((https?:\/\/[^\s)]+)\)$/.exec(line);
    if (image) {
      closeList();
      out.push(
        `<figure><img src="${image[2]}" alt="${esc(image[1] ?? "")}" loading="lazy" />${
          image[1] ? `<figcaption>${esc(image[1])}</figcaption>` : ""
        }</figure>`,
      );
      continue;
    }
    if (heading) {
      closeList();
      const level = Math.min(heading[1]!.length + 1, 5);
      out.push(`<h${level}>${inline(heading[2]!)}</h${level}>`);
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inline(bullet[1]!)}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join("\n");
}

/** JSON-LD is embedded inline in the article body, so guard against a stray "</script>" in generated text. */
function ldJson(obj: unknown): string {
  return JSON.stringify(obj).replace(/</g, "\\u003c");
}

/**
 * Article/BlogPosting structured data, plus FAQPage when the piece carries
 * a structured FAQ — this is what lets Google (rich results) and AI answer
 * engines (GEO) reliably extract the content instead of only reading prose.
 */
function articleSchema(opts: {
  title: string;
  excerpt?: string | null | undefined;
  coverUrl?: string | null | undefined;
  authorName?: string | null | undefined;
  publishedAt?: string | null | undefined;
  faq?: { question: string; answer: string }[] | null | undefined;
}): string {
  const article = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: opts.title,
    description: opts.excerpt || undefined,
    image: opts.coverUrl || undefined,
    datePublished: opts.publishedAt || undefined,
    dateModified: opts.publishedAt || undefined,
    author: opts.authorName ? { "@type": "Organization", name: opts.authorName } : undefined,
  };
  const blocks = [`<script type="application/ld+json">${ldJson(article)}</script>`];

  if (opts.faq?.length) {
    const faqPage = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: opts.faq.map((f) => ({
        "@type": "Question",
        name: f.question,
        acceptedAnswer: { "@type": "Answer", text: f.answer },
      })),
    };
    blocks.push(`<script type="application/ld+json">${ldJson(faqPage)}</script>`);
  }

  return blocks.join("\n");
}

/**
 * Wrap rendered article HTML in a self-contained magazine layout.
 * All styling is inline so it survives any CMS that strips <style> blocks.
 */
export function renderMagazineHtml(opts: {
  title: string;
  excerpt?: string | null | undefined;
  coverUrl?: string | null | undefined;
  markdown: string;
  faq?: { question: string; answer: string }[] | null | undefined;
  authorName?: string | null | undefined;
  publishedAt?: string | null | undefined;
}): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const body = renderMarkdown(opts.markdown)
    .replace(
      /<h2>/g,
      '<h2 style="font-family:Georgia,\'Times New Roman\',serif;font-size:1.6em;line-height:1.25;margin:2em 0 .5em;letter-spacing:-.01em;">',
    )
    .replace(
      /<h3>/g,
      '<h3 style="font-size:1.2em;line-height:1.3;margin:1.6em 0 .4em;text-transform:uppercase;letter-spacing:.08em;">',
    )
    .replace(/<p>/g, '<p style="margin:0 0 1.15em;font-size:1.05em;line-height:1.75;">')
    .replace(/<ul>/g, '<ul style="margin:0 0 1.4em 1.2em;line-height:1.7;">')
    .replace(/<li>/g, '<li style="margin:0 0 .4em;">')
    .replace(
      /<figure>/g,
      '<figure style="margin:2em 0;"><span style="display:block;">',
    )
    .replace(/<\/figure>/g, "</span></figure>")
    .replace(/<img /g, '<img style="width:100%;height:auto;border-radius:12px;display:block;" ')
    .replace(
      /<figcaption>/g,
      '<figcaption style="margin-top:.6em;font-size:.85em;opacity:.7;text-align:center;">',
    );

  const cover = opts.coverUrl
    ? `<figure style="margin:0 0 2em;"><img src="${esc(opts.coverUrl)}" alt="${esc(
        opts.title,
      )}" style="width:100%;height:auto;border-radius:14px;display:block;" /></figure>`
    : "";

  const lede = opts.excerpt
    ? `<p style="font-size:1.25em;line-height:1.6;font-style:italic;opacity:.85;margin:0 0 1.6em;border-left:3px solid currentColor;padding-left:1em;">${esc(
        opts.excerpt,
      )}</p>`
    : "";

  const schema = articleSchema({
    title: opts.title,
    excerpt: opts.excerpt,
    coverUrl: opts.coverUrl,
    authorName: opts.authorName,
    publishedAt: opts.publishedAt,
    faq: opts.faq,
  });

  return `<article style="max-width:760px;margin:0 auto;font-family:Georgia,'Times New Roman',serif;">
<h1 style="font-size:2.2em;line-height:1.15;letter-spacing:-.02em;margin:0 0 .6em;">${esc(
    opts.title,
  )}</h1>
${lede}${cover}${body}
${schema}
</article>`;
}