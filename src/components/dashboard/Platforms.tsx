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
    <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
      <div className="surface p-5">
        <h2 className="font-display text-lg font-semibold">Connected destinations</h2>
        <div className="mt-4 space-y-2">
          {integrations.length === 0 && (
            <p className="text-sm text-muted-foreground">No destination yet — add one on the right.</p>
          )}
          {integrations.map((i) => (
            <div key={i.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-[11px] border border-border bg-card">
                <PlatformLogo platform={i.platform} className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{i.label}</p>
                <p className="font-mono text-[11px] text-muted-foreground">
                  {PLATFORM_META[i.platform as PlatformId]?.label ?? i.platform}
                </p>
                {i.last_error && <p className="mt-1 text-[11px] text-destructive">{i.last_error}</p>}
              </div>
              <Button size="sm" variant="ghost" onClick={() => remove.mutate(i.id)}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      </div>

      <div className="surface p-5">
        <h2 className="font-display text-lg font-semibold">Add a destination</h2>
        <div className="mt-4 space-y-4">
          <div>
            <Label>Platform</Label>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {(Object.entries(PLATFORM_META) as [PlatformId, (typeof PLATFORM_META)[PlatformId]][]).map(([id, meta]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setPlatform(id);
                    setValues({});
                  }}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition ${
                    platform === id ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "border-border hover:bg-muted/50"
                  }`}
                >
                  <PlatformLogo platform={id} className="size-5 shrink-0" />
                  <span className="truncate text-[12.5px] font-medium">{meta.label}</span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-[12px] text-muted-foreground">{PLATFORM_META[platform].hint}</p>
          </div>
          <div>
            <Label htmlFor="label">Name</Label>
            <Input id="label" value={label} onChange={(e) => setLabel(e.target.value)} className="mt-1.5" placeholder="Mon blog principal" />
          </div>
          {PLATFORM_META[platform].fields.map((field) => (
            <div key={field.key}>
              <Label htmlFor={field.key}>{field.label}</Label>
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
  );
}