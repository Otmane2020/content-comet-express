export type BlogPost = {
  slug: string;
  title: string;
  description: string;
  publishedAt: string;
  updatedAt?: string;
  author: string;
  readMinutes: number;
  tags: string[];
  content: { type: "h2" | "h3" | "p" | "ul"; text: string; items?: string[] }[];
};

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: "what-is-generative-engine-optimisation",
    title: "What is Generative Engine Optimisation (GEO)?",
    description:
      "Generative Engine Optimisation is the practice of making your brand the answer AI search engines quote. Learn how GEO differs from SEO and how to start.",
    publishedAt: "2026-08-05",
    author: "Ranki.ai Editorial",
    readMinutes: 6,
    tags: ["GEO", "AI search", "SEO"],
    content: [
      {
        type: "p",
        text: "For years, search engine optimisation meant climbing the blue links. Today, the first answer many users see is not a page at all — it is a summary written by ChatGPT, Perplexity, Gemini or an AI Overview. Generative Engine Optimisation (GEO) is the discipline of becoming the source those summaries cite.",
      },
      {
        type: "h2",
        text: "How GEO differs from SEO",
      },
      {
        type: "p",
        text: "SEO optimises for ranking signals: keywords, backlinks, technical health and click-through rate. GEO optimises for being quotable. A generative engine does not list pages; it synthesises an answer from the sources it trusts. GEO therefore asks: does your content clearly answer the exact question a user is asking, and does it look authoritative enough to be cited?",
      },
      {
        type: "h2",
        text: "What makes content quotable",
      },
      {
        type: "p",
        text: "Research from visibility studies in 2025 and 2026 suggests that generative engines favour content that is:",
      },
      {
        type: "ul",
        text: "",
        items: [
          "Directly relevant to the query and written in plain language",
          "Structured with clear headings, definitions and numbered steps",
          "Cited or corroborated by other reputable sources",
          "Authoritative on a focused topic rather than a thin page on many topics",
          "Kept up to date, especially in fast-moving industries",
        ],
      },
      {
        type: "h2",
        text: "A practical GEO workflow",
      },
      {
        type: "p",
        text: "Start with the questions your customers actually ask. Group them into informational, transactional and local intent. For each question, write a concise answer in the first paragraph, then expand with evidence, examples and a clear next step. Use tables, FAQs and lists where they help a reader — and an AI — scan the answer quickly. Finally, link to related answers on your own site so the engine sees your brand as a coherent authority on the topic.",
      },
      {
        type: "h2",
        text: "GEO and SEO work together",
      },
      {
        type: "p",
        text: "GEO does not replace SEO. A page still needs to be crawlable, fast and well-linked to be discovered. But once discovered, GEO determines whether it becomes the cited answer. The best content strategy in 2026 does both: rank in traditional search and get quoted in generative answers.",
      },
    ],
  },
  {
    slug: "how-to-automate-a-30-day-content-calendar",
    title: "How to automate a 30-day content calendar without losing quality",
    description:
      "AI can plan, write and publish a month of articles. Here is how to keep the output useful, accurate and on-brand while you sleep.",
    publishedAt: "2026-08-07",
    author: "Ranki.ai Editorial",
    readMinutes: 7,
    tags: ["AI content", "content automation", "editorial workflow"],
    content: [
      {
        type: "p",
        text: "A 30-day content calendar sounds like a lot of work. When you add keyword research, competitor analysis, drafting, editing, images and publishing, it can easily consume a full week every month. Automation promises to give that time back — but only if the output stays useful, accurate and on-brand.",
      },
      {
        type: "h2",
        text: "Start with the strategy, not the prompt",
      },
      {
        type: "p",
        text: "The weakest AI content comes from a vague prompt. The strongest comes from a clear brief: your target audience, the topics you want to own, the formats you will rotate through, and the competitors you want to surpass. Lock this strategy in first. The AI's job is to execute the strategy consistently, not to invent one for you.",
      },
      {
        type: "h2",
        text: "Rotate formats so every post has a job",
      },
      {
        type: "p",
        text: "A healthy calendar mixes intent. One day might answer a question (AEO). The next might target a keyword cluster (SEO). Another might compare products (Shopping). A fourth might be a local event or service update (Local). Rotation prevents keyword cannibalisation and keeps readers — and search engines — engaged.",
      },
      {
        type: "h2",
        text: "Build in review gates",
      },
      {
        type: "p",
        text: "Fully hands-off publishing is possible, but most businesses start with a draft queue. Let the AI generate the article, then review it for factual accuracy, tone and brand voice. When you trust the output, switch the destination to auto-publish. This staged approach keeps quality high while still removing the bulk of the manual work.",
      },
      {
        type: "h2",
        text: "Add images, not decoration",
      },
      {
        type: "p",
        text: "Every article should have a visual anchor. A cover image helps social sharing and newsletter open rates. Inline diagrams or screenshots can clarify complex steps. AI-generated images work best when the prompt is specific and avoids text, which current image models often render poorly. The goal is an illustration, not a banner full of unreadable words.",
      },
      {
        type: "h2",
        text: "Measure and feed the loop",
      },
      {
        type: "p",
        text: "Connect Search Console so you can see which articles gain impressions and clicks. Use that data to update older posts, double down on winning topics, and deprioritise formats that do not move. The calendar is not a publishing treadmill; it is a learning system.",
      },
    ],
  },
  {
    slug: "local-seo-and-google-business-profile-in-2026",
    title: "Local SEO and Google Business Profile in 2026",
    description:
      "Local search is changing. Here is how to use Google Business Profile posts, reviews and on-page signals to win nearby customers this year.",
    publishedAt: "2026-08-09",
    author: "Ranki.ai Editorial",
    readMinutes: 5,
    tags: ["Local SEO", "Google Business Profile", "local marketing"],
    content: [
      {
        type: "p",
        text: "Local search has always been about proximity, prominence and relevance. In 2026, those signals still matter, but the way you feed them has shifted. A Google Business Profile is no longer just a listing — it is a publishing channel, a review hub and a trust signal all in one.",
      },
      {
        type: "h2",
        text: "Post regularly, not sporadically",
      },
      {
        type: "p",
        text: "Businesses that publish updates, offers and events on their Google Business Profile tend to show more activity in local packs. A simple weekly rhythm works: one post about a service, one about a recent project or customer question, and one event or offer. Short is fine; consistency is what matters.",
      },
      {
        type: "h2",
        text: "Reviews are still the strongest local signal",
      },
      {
        type: "p",
        text: "Quantity, recency and quality of reviews all influence local rank. The best review strategy is honest: ask satisfied customers, make it easy with a direct link, and respond to every review — positive or negative. A thoughtful response shows future customers that you are engaged.",
      },
      {
        type: "h2",
        text: "Match your website to your profile",
      },
      {
        type: "p",
        text: "Your website should reinforce the same location and service keywords. Create a dedicated page for each primary service area, include local schema markup, and link back to your Google Business Profile. When your website and profile tell the same story, both become more credible.",
      },
      {
        type: "h2",
        text: "Automate local posts without losing the human touch",
      },
      {
        type: "p",
        text: "AI can draft local posts from your daily articles, but the final check should be human. Make sure the offer is accurate, the location is correct, and the tone sounds like your business. The businesses that win local search in 2026 will be the ones that combine automation with genuine local knowledge.",
      },
    ],
  },
];

export function getBlogPost(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((p) => p.slug === slug);
}
