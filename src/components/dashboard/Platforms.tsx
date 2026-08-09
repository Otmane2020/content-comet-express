import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PLATFORM_META, type PlatformId } from "@/lib/geo";
import { PlatformLogo } from "@/components/PlatformLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Integration = {
  id: string;
  platform: string;
  label: string;
  status: string;
  last_error: string | null;
};

export function Platforms({ projectId, userId }: { projectId: string; userId: string }) {
  const qc = useQueryClient();
  const [platform, setPlatform] = useState<PlatformId>("wordpress");
  const [values, setValues] = useState<Record<string, string>>({});
  const [label, setLabel] = useState("");

  const { data: integrations = [] } = useQuery({
    queryKey: ["integrations", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("integrations")
        .select("id, platform, label, status, last_error")
        .eq("project_id", projectId)
        .order("created_at");
      if (error) throw error;
      return data as Integration[];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("integrations").insert({
        user_id: userId,
        project_id: projectId,
        platform,
        label: label || PLATFORM_META[platform].label,
        config: values,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Destination connected.");
      setValues({});
      setLabel("");
      void qc.invalidateQueries({ queryKey: ["integrations", projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("integrations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["integrations", projectId] }),
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-[25px] font-bold leading-tight">Destinations</h1>
        <p className="mt-1 text-[14.5px] text-muted-foreground">
          Where every article gets published. Connect a site once — the autopilot handles the rest.
        </p>
      </header>

      <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
        Connected destinations
      </p>
      <div className="surface p-6">
        {integrations.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
            <h3 className="font-display text-base font-semibold">No destination yet</h3>
            <p className="mx-auto mt-1.5 max-w-sm text-[13.5px] leading-relaxed text-muted-foreground">
              Pick a platform below and paste your credentials — articles will start going live automatically.
            </p>
          </div>
        ) : (
          <div>
            {integrations.map((i) => (
              <div
                key={i.id}
                className="flex flex-wrap items-center gap-3 border-b border-border py-4 first:pt-0 last:border-b-0 last:pb-0"
              >
                <span className="flex size-[38px] shrink-0 items-center justify-center rounded-[10px] border border-border bg-secondary/60">
                  <PlatformLogo platform={i.platform} className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold">{i.label}</p>
                  <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                    {PLATFORM_META[i.platform as PlatformId]?.label ?? i.platform}
                  </p>
                  {i.last_error && <p className="mt-1 text-[11.5px] text-destructive">{i.last_error}</p>}
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-[11.5px] font-bold ${
                    i.last_error ? "bg-warning-soft text-warning" : "bg-success-soft text-success"
                  }`}
                >
                  {i.last_error ? "Needs attention" : "Connected"}
                </span>
                <Button size="sm" variant="ghost" onClick={() => remove.mutate(i.id)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
        Add a destination
      </p>
      <div className="surface grid gap-6 p-6 lg:grid-cols-[1fr_1fr]">
        <div>
          <h2 className="font-display text-base font-semibold">1. Choose the platform</h2>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            We publish through the official API — no plugin to install.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2.5">
              {(Object.entries(PLATFORM_META) as [PlatformId, (typeof PLATFORM_META)[PlatformId]][]).map(([id, meta]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setPlatform(id);
                    setValues({});
                  }}
                className={`flex items-center gap-2.5 rounded-xl border px-3 py-3 text-left transition ${
                  platform === id
                    ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                    : "border-border hover:bg-muted/50"
                }`}
              >
                <PlatformLogo platform={id} className="size-5 shrink-0" />
                <span className="truncate text-[12.5px] font-semibold">{meta.label}</span>
              </button>
            ))}
          </div>
          <p className="mt-3 rounded-lg bg-secondary/60 px-3 py-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
            {PLATFORM_META[platform].hint}
          </p>
        </div>

        <div>
          <h2 className="font-display text-base font-semibold">2. Enter your credentials</h2>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            Stored encrypted and used only to publish your own content.
          </p>
          <div className="mt-4 space-y-3.5">
            <div>
              <Label htmlFor="label" className="text-[12.5px]">Name</Label>
              <Input
                id="label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="mt-1.5"
                placeholder="Mon blog principal"
              />
            </div>
            {PLATFORM_META[platform].fields.map((field) => (
              <div key={field.key}>
                <Label htmlFor={field.key} className="text-[12.5px]">{field.label}</Label>
                <Input
                  id={field.key}
                  type={field.secret ? "password" : "text"}
                  value={values[field.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                  placeholder={field.placeholder}
                  className="mt-1.5"
                />
              </div>
            ))}
            <Button
              onClick={() => add.mutate()}
              disabled={add.isPending}
              className="w-full bg-deep text-background hover:bg-deep/90"
            >
              {add.isPending ? "Connecting…" : "Connect destination"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}