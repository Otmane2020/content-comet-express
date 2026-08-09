import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ExternalLink, Loader2, PenLine, Send, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { generateArticle, publishItem } from "@/lib/autopilot.functions";
import { STATUS_META, TYPE_META, type ContentType } from "@/lib/geo";
import { renderMarkdown } from "@/lib/markdown";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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
};

export function Calendar({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const generate = useServerFn(generateArticle);
  const publish = useServerFn(publishItem);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ title: string; body: string } | null>(null);

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

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Days planned", value: items.length },
          { label: "Drafts ready", value: ready },
          { label: "Published", value: done },
        ].map((stat) => (
          <div key={stat.label} className="surface px-5 py-4">
            <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">{stat.label}</p>
            <p className="mt-1 font-display text-2xl font-bold">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="surface mt-5 divide-y divide-border overflow-hidden">
        {isLoading && (
          <p className="px-5 py-6 text-sm text-muted-foreground">Loading your calendar…</p>
        )}
        {!isLoading && items.length === 0 && (
          <p className="px-5 py-6 text-sm text-muted-foreground">No content planned yet.</p>
        )}
        {items.map((item) => {
          const meta = TYPE_META[item.content_type as ContentType];
          const status = STATUS_META[item.status] ?? STATUS_META["planned"]!;
          const busy =
            (genMutation.isPending && genMutation.variables === item.id) ||
            (pubMutation.isPending && pubMutation.variables === item.id);
          return (
            <div key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-secondary/50">
              <span className="w-24 font-mono text-[12px] text-muted-foreground">{item.scheduled_date}</span>
              <span className={`rounded-md px-2 py-0.5 font-mono text-[10px] font-semibold ${meta?.tone ?? ""}`}>
                {meta?.short ?? item.content_type}
              </span>
              <button
                type="button"
                onClick={() => {
                  setOpenId(item.id);
                  setDraft({ title: item.title ?? item.topic ?? "", body: item.body_md ?? "" });
                }}
                className="min-w-40 flex-1 truncate text-left text-[14px] font-medium hover:text-primary"
              >
                {item.title ?? item.topic ?? "Untitled slot"}
              </button>
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${status.className}`}>
                {status.label}
              </span>
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

      <Sheet open={!!open} onOpenChange={(v) => !v && setOpenId(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle className="font-display">
              {open ? TYPE_META[open.content_type as ContentType]?.label : ""} · {open?.scheduled_date}
            </SheetTitle>
          </SheetHeader>
          {open && draft && (
            <div className="space-y-4 px-4 pb-8">
              <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              {open.body_md ? (
                <>
                  <Textarea
                    rows={16}
                    value={draft.body}
                    onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                    className="font-mono text-[12.5px]"
                  />
                  <div className="flex gap-2">
                    <Button onClick={saveDraft} variant="outline" size="sm">
                      <PenLine className="size-4" /> Save draft
                    </Button>
                    <Button
                      size="sm"
                      className="bg-deep text-background hover:bg-deep/90"
                      onClick={() => pubMutation.mutate(open.id)}
                    >
                      <Send className="size-4" /> Publish
                    </Button>
                  </div>
                  <div
                    className="prose-geo rounded-xl border border-border bg-secondary/40 p-4 text-[14px]"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(draft.body) }}
                  />
                </>
              ) : (
                <div className="rounded-xl border border-dashed border-border p-6 text-center">
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
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}