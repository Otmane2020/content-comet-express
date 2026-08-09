import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const HOURS = Array.from({ length: 24 }, (_, h) => {
  const label =
    h === 0 ? "Midnight · 00:00" : h === 12 ? "Midday · 12:00" : `${String(h).padStart(2, "0")}:00`;
  return { value: h, label };
});

const ZONES = [
  "UTC",
  "Europe/London",
  "Europe/Paris",
  "Europe/Madrid",
  "Europe/Berlin",
  "Africa/Casablanca",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Asia/Dubai",
  "Asia/Singapore",
  "Australia/Sydney",
];

export function PublishSchedule({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [hour, setHour] = useState("9");
  const [zone, setZone] = useState("UTC");

  const { data } = useQuery({
    queryKey: ["publish-schedule", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("publish_hour, timezone")
        .eq("id", projectId)
        .single();
      if (error) throw error;
      return data as unknown as { publish_hour: number | null; timezone: string | null };
    },
  });

  useEffect(() => {
    if (!data) return;
    setHour(String(data.publish_hour ?? 9));
    setZone(data.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("projects")
        .update({ publish_hour: Number(hour), timezone: zone } as never)
        .eq("id", projectId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Publishing time saved.");
      void qc.invalidateQueries({ queryKey: ["publish-schedule", projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const zones = ZONES.includes(zone) ? ZONES : [zone, ...ZONES];

  return (
    <div className="surface p-6">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gold-soft text-gold-foreground">
          <Clock className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-base font-semibold">Publishing time</h2>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Pick when the autopilot writes and pushes the day&apos;s article to every connected
            destination. We check every hour and fire at your local time.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <Select value={hour} onValueChange={setHour}>
          <SelectTrigger className="bg-background">
            <SelectValue placeholder="Hour" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {HOURS.map((h) => (
              <SelectItem key={h.value} value={String(h.value)}>
                {h.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={zone} onValueChange={setZone}>
          <SelectTrigger className="bg-background">
            <SelectValue placeholder="Time zone" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {zones.map((z) => (
              <SelectItem key={z} value={z}>
                {z.replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="bg-deep text-background hover:bg-deep/90"
        >
          {save.isPending ? "Saving…" : "Save time"}
        </Button>
      </div>
    </div>
  );
}