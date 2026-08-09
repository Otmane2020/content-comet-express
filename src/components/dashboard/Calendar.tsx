import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  PenLine,
  Send,
  Sparkles,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { generateArticle, illustrateArticle, publishItem } from "@/lib/autopilot.functions";
import { STATUS_META, TYPE_META, type ContentType } from "@/lib/geo";
import { renderMarkdown } from "@/lib/markdown";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

type Item = {
  id: string;
  scheduled_date: string;
  content_type: string;
  topic: string | null;
  title: string | null;
  excerpt: string | null;
  body_md: string | null;
  status: string;
  published_url: string | null;
  cover_image_url: string | null;
};

export function Calendar({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const generate = useServerFn(generateArticle);
  const publish = useServerFn(publishItem);
  const illustrate = useServerFn(illustrateArticle);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ title: string; body: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [page, setPage] = useState(0);
  const PER_PAGE = 5;

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["content", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("content_items")
        .select("*")
        .eq("project_id", projectId)
        .order("scheduled_date");
      if (error) throw error;
      return data as Item[];
    },
  });

  const open = useMemo(() => items.find((i) => i.id === openId) ?? null, [items, openId]);

  const genMutation = useMutation({
    mutationFn: (itemId: string) => generate({ data: { itemId } }),
    onSuccess: () => {
      toast.success("Article written.");
      void qc.invalidateQueries({ queryKey: ["content", projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pubMutation = useMutation({
    mutationFn: (itemId: string) => publish({ data: { itemId } }),
    onSuccess: (res) => {
      const ok = res.results.filter((r) => r.success).length;
      const failed = res.results.filter((r) => !r.success);
      if (ok) toast.success(`Published on ${ok} platform${ok > 1 ? "s" : ""}.`);
      failed.forEach((f) => toast.error(`${f.platform}: ${f.message}`));
      void qc.invalidateQueries({ queryKey: ["content", projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const imgMutation = useMutation({
    mutationFn: (itemId: string) =>
      illustrate({ data: { itemId, origin: window.location.origin } }),
    onSuccess: () => {
      toast.success("Images added to the article.");
      void qc.invalidateQueries({ queryKey: ["content", projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function saveDraft() {
    if (!open || !draft) return;
    const { error } = await supabase
      .from("content_items")
      .update({ title: draft.title, body_md: draft.body })
      .eq("id", open.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Draft saved.");
    void qc.invalidateQueries({ queryKey: ["content", projectId] });
  }

  const done = items.filter((i) => i.status === "published").length;
  const ready = items.filter((i) => i.status === "draft").length;
  const pageCount = Math.max(1, Math.ceil(items.length / PER_PAGE));
  const pageItems = items.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);

  useEffect(() => {
    if (page > pageCount - 1) setPage(pageCount - 1);
  }, [page, pageCount]);

  return (
    <div>
      <div className="relative overflow-hidden rounded-2xl bg-deep p-6 text-background">
        <div
          className="pointer-events-none absolute -right-10 -top-24 size-56 rounded-full bg-gold/25 blur-3xl"
          aria-hidden
        />
        <div className="relative flex flex-wrap items-end justify-between gap-5">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-gold/20 px-3 py-1 font-mono text-[10.5px] font-bold uppercase tracking-[0.12em] text-gold">
              <Sparkles className="size-3" />
              Rolling 30 days
            </span>
            <h2 className="mt-3 font-display text-[24px] font-bold leading-tight">Your content calendar</h2>
            <p className="mt-1.5 max-w-xl text-[13.5px] leading-relaxed text-background/70">
              One piece per day, written from your keywords and published on its own. The window
              refills automatically so you always have 30 days ahead.
            </p>
          </div>
          <div className="flex gap-6">
            {[
              { label: "Planned", value: items.length },
              { label: "Drafts", value: ready },
              { label: "Published", value: done },
            ].map((stat) => (
              <div key={stat.label}>
                <p className="font-display text-[26px] font-bold leading-none text-gold">{stat.value}</p>
                <p className="mt-1 font-mono text-[10.5px] uppercase tracking-[0.08em] text-background/60">
                  {stat.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <h3 className="font-display text-[15px] font-bold">Rolling schedule</h3>
        <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
          {items.length ? `${page * PER_PAGE + 1}–${Math.min((page + 1) * PER_PAGE, items.length)} of ${items.length}` : "—"}
        </p>
      </div>

      <div className="mt-3 space-y-3">
        {isLoading && (
          <p className="surface px-5 py-6 text-sm text-muted-foreground">Loading your calendar…</p>
        )}
        {!isLoading && items.length === 0 && (
          <p className="surface px-5 py-6 text-sm text-muted-foreground">No content planned yet.</p>
        )}
        {pageItems.map((item) => {
          const meta = TYPE_META[item.content_type as ContentType];
          const status = STATUS_META[item.status] ?? STATUS_META["planned"]!;
          const busy =
            (genMutation.isPending && genMutation.variables === item.id) ||
            (pubMutation.isPending && pubMutation.variables === item.id);
          const d = new Date(`${item.scheduled_date}T00:00:00`);
          return (
            <div
              key={item.id}
              className="surface group relative flex flex-wrap items-center gap-4 overflow-hidden px-4 py-4 pl-5 transition-all hover:border-primary/40 hover:shadow-sm"
            >
              <span
                className="absolute inset-y-0 left-0 w-1 bg-transparent transition-colors group-hover:bg-gold"
                aria-hidden
              />
              <div className="flex size-14 shrink-0 flex-col items-center justify-center rounded-xl bg-primary/10 text-center text-primary">
                <span className="font-mono text-[10px] uppercase tracking-wide opacity-70">
                  {d.toLocaleDateString("en-US", { month: "short" })}
                </span>
                <span className="font-display text-lg font-bold leading-none">{d.getDate()}</span>
              </div>
              {item.cover_image_url && (
                <img
                  src={item.cover_image_url}
                  alt=""
                  className="hidden size-14 shrink-0 rounded-xl object-cover sm:block"
                />
              )}
              <div className="min-w-40 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-md px-2 py-0.5 font-mono text-[10px] font-semibold ${meta?.tone ?? ""}`}>
                    {meta?.short ?? item.content_type}
                  </span>
                  <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${status.className}`}>
                    {status.label}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setOpenId(item.id);
                    setDraft({ title: item.title ?? item.topic ?? "", body: item.body_md ?? "" });
                  }}
                  className="mt-1.5 block w-full truncate text-left text-[14.5px] font-semibold hover:text-primary"
                >
                  {item.title ?? item.topic ?? "Untitled slot"}
                </button>
                {item.excerpt && (
                  <p className="mt-0.5 line-clamp-1 text-[12.5px] text-muted-foreground">{item.excerpt}</p>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => genMutation.mutate(item.id)}
                  title="Generate with DeepSeek"
                >
                  {busy && genMutation.variables === item.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Sparkles className="size-4" />
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || !item.body_md}
                  onClick={() => pubMutation.mutate(item.id)}
                  title="Publish everywhere"
                >
                  {busy && pubMutation.variables === item.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                </Button>
                {item.published_url && (
                  <a href={item.published_url} target="_blank" rel="noopener" className="p-2 text-muted-foreground hover:text-primary">
                    <ExternalLink className="size-4" />
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {pageCount > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="size-4" />
          </Button>
          {Array.from({ length: pageCount }).map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setPage(i)}
              className={`size-8 rounded-lg font-mono text-[12px] font-semibold transition-colors ${
                i === page ? "bg-deep text-background" : "bg-secondary text-muted-foreground hover:text-foreground"
              }`}
            >
              {i + 1}
            </button>
          ))}
          <Button
            variant="outline"
            size="sm"
            disabled={page >= pageCount - 1}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}

      <Dialog
        open={!!open}
        onOpenChange={(v) => {
          if (!v) {
            setOpenId(null);
            setEditing(false);
          }
        }}
      >
        <DialogContent
          className="max-h-[92vh] w-[96vw] max-w-3xl overflow-y-auto p-0 sm:max-w-3xl"
        >
          {open && draft && (
            <article className="pb-10">
              <div className="relative">
                {open.cover_image_url ? (
                  <img
                    src={open.cover_image_url}
                    alt={open.title ?? "Article cover"}
                    className="h-56 w-full object-cover sm:h-72"
                  />
                ) : (
                  <div className="paper-grid h-32 w-full bg-secondary sm:h-40" />
                )}
              </div>

              <div className="px-6 sm:px-10">
                <div className="-mt-6 flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-md px-2 py-0.5 font-mono text-[10px] font-semibold ${
                      TYPE_META[open.content_type as ContentType]?.tone ?? ""
                    }`}
                  >
                    {TYPE_META[open.content_type as ContentType]?.label ?? open.content_type}
                  </span>
                  <span className="rounded-full bg-background/90 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground backdrop-blur">
                    {open.scheduled_date}
                  </span>
                </div>

                <DialogTitle asChild>
                  <h1 className="mt-4 font-display text-[28px] font-extrabold leading-tight tracking-tight sm:text-[34px]">
                    {draft.title || "Untitled slot"}
                  </h1>
                </DialogTitle>
                {open.excerpt && (
                  <p className="mt-3 border-l-2 border-primary pl-4 text-[15px] italic text-muted-foreground">
                    {open.excerpt}
                  </p>
                )}

                <div className="mt-5 flex flex-wrap items-center gap-2 border-y border-border py-3">
                  <Button size="sm" variant="outline" onClick={() => setEditing((e) => !e)}>
                    <PenLine className="size-4" /> {editing ? "Reading view" : "Edit"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={imgMutation.isPending || !open.body_md}
                    onClick={() => imgMutation.mutate(open.id)}
                  >
                    {imgMutation.isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ImageIcon className="size-4" />
                    )}
                    Illustrate
                  </Button>
                  <Button
                    size="sm"
                    className="bg-deep text-background hover:bg-deep/90"
                    disabled={!open.body_md}
                    onClick={() => pubMutation.mutate(open.id)}
                  >
                    <Send className="size-4" /> Publish
                  </Button>
                  {open.published_url && (
                    <a
                      href={open.published_url}
                      target="_blank"
                      rel="noopener"
                      className="ml-auto inline-flex items-center gap-1 text-[12px] font-semibold text-primary"
                    >
                      Live <ExternalLink className="size-3.5" />
                    </a>
                  )}
                </div>

                {open.body_md ? (
                  editing ? (
                    <div className="mt-5 space-y-3">
                      <Input
                        value={draft.title}
                        onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                      />
                      <Textarea
                        rows={20}
                        value={draft.body}
                        onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                        className="font-mono text-[12.5px]"
                      />
                      <Button onClick={saveDraft} variant="outline" size="sm">
                        <PenLine className="size-4" /> Save draft
                      </Button>
                    </div>
                  ) : (
                    <div
                      className="prose-magazine mt-6"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(draft.body) }}
                    />
                  )
                ) : (
                  <div className="mt-8 rounded-xl border border-dashed border-border p-8 text-center">
                    <p className="text-sm text-muted-foreground">{open.topic}</p>
                    <Button
                      className="mt-4 bg-deep text-background hover:bg-deep/90"
                      disabled={genMutation.isPending}
                      onClick={() => genMutation.mutate(open.id)}
                    >
                      {genMutation.isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Sparkles className="size-4" />
                      )}
                      Write this article
                    </Button>
                  </div>
                )}
              </div>
            </article>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}