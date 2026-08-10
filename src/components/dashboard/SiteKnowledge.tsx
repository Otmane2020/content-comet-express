import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Check,
  ExternalLink,
  FileText,
  Images,
  Link2,
  Package,
  RefreshCw,
  Search,
} from "lucide-react";
import { getImportedData, getSiteKnowledge, syncSiteKnowledge } from "@/lib/sitecrawl.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";

type Knowledge = Awaited<ReturnType<typeof getSiteKnowledge>>;

/**
 * "We understood your site" confidence check: a small summary, never the raw
 * crawl detail — the merchant just needs to see Ranki actually knows their
 * catalogue and pages before 30 days of content get generated from it.
 */
export function SiteKnowledge({ projectId }: { projectId: string }) {
  const load = useServerFn(getSiteKnowledge);
  const sync = useServerFn(syncSiteKnowledge);
  const [data, setData] = useState<Knowledge | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  function refresh() {
    setLoading(true);
    load({ data: { projectId } })
      .then(setData)
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }

  useEffect(refresh, [projectId]);

  async function rescan() {
    setSyncing(true);
    try {
      const res = await sync({ data: { projectId } });
      toast.success(`Site re-scanned — ${res.pages} pages read.`);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not scan the site");
    } finally {
      setSyncing(false);
    }
  }

  const stats = data
    ? [
        { icon: FileText, label: "Pages", value: data.pageCount },
        { icon: Package, label: "Products", value: data.productCount },
        { icon: Images, label: "Images", value: data.imageCount },
        { icon: Link2, label: "Internal links", value: data.linkCount },
      ]
    : [];

  return (
    <div className="surface max-w-xl space-y-4 p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold">Website data</h2>
        {!loading && data && data.pageCount > 0 && (
          <span className="flex items-center gap-1 text-[12px] font-semibold text-success">
            <Check className="size-3.5" /> Synced
          </span>
        )}
      </div>
      <p className="text-[12.5px] leading-relaxed text-muted-foreground">
        What Ranki actually read from your site before writing anything — your catalogue, pages and
        internal links.
      </p>

      {loading ? (
        <p className="text-[12.5px] text-muted-foreground">Loading…</p>
      ) : !data || data.pageCount === 0 ? (
        <p className="rounded-xl border border-gold/30 bg-gold-soft/50 px-4 py-3 text-[12.5px] leading-relaxed text-foreground/80">
          Not scanned yet. Add your website above, save, then scan it.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {stats.map((s) => (
              <div
                key={s.label}
                className="rounded-xl border border-border bg-secondary/40 p-3 text-center"
              >
                <s.icon className="mx-auto size-4 text-primary" />
                <p className="mt-1.5 font-display text-lg font-bold leading-none">{s.value}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
          <p className="text-[11.5px] text-muted-foreground">
            Last scan: {data.lastScan ? new Date(data.lastScan).toLocaleString() : "—"}
          </p>
        </>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => setDialogOpen(true)}
          disabled={!data?.pageCount}
        >
          View imported data
        </Button>
        <Button type="button" variant="outline" onClick={rescan} disabled={syncing}>
          <RefreshCw className={`mr-1.5 size-3.5 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Scanning…" : data?.pageCount ? "Re-scan site" : "Scan now"}
        </Button>
      </div>

      <ImportedDataDialog projectId={projectId} open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}

type ImportedRow = { title: string; subtitle: string; url: string; status: "Imported" };

function ImportedDataDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const fetchRows = useServerFn(getImportedData);
  const [type, setType] = useState<"pages" | "products" | "images">("pages");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<ImportedRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      fetchRows({ data: { projectId, type, search: search || undefined } })
        .then((r) => {
          if (!cancelled) setRows(r.rows);
        })
        .catch(() => {
          if (!cancelled) setRows([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, projectId, type, search, fetchRows]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="text-base">Imported data</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 px-5 py-4">
          <Tabs value={type} onValueChange={(v) => setType(v as typeof type)}>
            <TabsList>
              <TabsTrigger value="pages">Pages</TabsTrigger>
              <TabsTrigger value="products">Products</TabsTrigger>
              <TabsTrigger value="images">Images</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="h-8 pl-8 text-[13px]"
            />
          </div>

          <div className="max-h-[45vh] overflow-y-auto">
            {loading ? (
              <p className="py-6 text-center text-[12.5px] text-muted-foreground">Loading…</p>
            ) : !rows.length ? (
              <p className="py-6 text-center text-[12.5px] text-muted-foreground">Nothing found.</p>
            ) : type === "images" ? (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {rows.map((r) => (
                  <a
                    key={r.url}
                    href={r.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group overflow-hidden rounded-lg border border-border"
                    title={r.title}
                  >
                    <img
                      src={r.url}
                      alt={r.title}
                      loading="lazy"
                      className="aspect-square w-full object-cover"
                    />
                  </a>
                ))}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.url || r.title}>
                      <TableCell>
                        <p className="text-[13px] font-medium">{r.title}</p>
                        {r.subtitle && (
                          <p className="text-[11.5px] text-muted-foreground">{r.subtitle}</p>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-semibold text-success">
                          {r.status}
                        </span>
                      </TableCell>
                      <TableCell>
                        {r.url && (
                          <a
                            href={r.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-muted-foreground hover:text-primary"
                          >
                            <ExternalLink className="size-3.5" />
                          </a>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
