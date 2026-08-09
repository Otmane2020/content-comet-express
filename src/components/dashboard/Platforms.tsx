import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plug, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PLATFORM_META, type PlatformId } from "@/lib/geo";
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
              <Plug className="size-4 text-primary" />
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
            <Label htmlFor="platform">Platform</Label>
            <select
              id="platform"
              value={platform}
              onChange={(e) => {
                setPlatform(e.target.value as PlatformId);
                setValues({});
              }}
              className="mt-1.5 h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            >
              {Object.entries(PLATFORM_META).map(([id, meta]) => (
                <option key={id} value={id}>
                  {meta.label}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-[12px] text-muted-foreground">{PLATFORM_META[platform].hint}</p>
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