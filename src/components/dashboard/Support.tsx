import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { LifeBuoy, Mail, Send, Clock } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { submitSupportTicket } from "@/lib/support.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function Support() {
  const { user } = useAuth();
  const send = useServerFn(submitSupportTicket);
  const [form, setForm] = useState({ email: user?.email ?? "", subject: "", message: "" });
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.subject.trim().length < 3) return toast.error("Add a short subject.");
    if (form.message.trim().length < 10) return toast.error("Tell us a bit more (10+ characters).");
    setBusy(true);
    try {
      const res = await send({ data: { ...form, email: form.email.trim() } });
      if (res.emailed) toast.success("Message sent — we'll reply by email.");
      else toast.success("Message saved. Our team will get back to you.");
      setForm((f) => ({ ...f, subject: "", message: "" }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send your message");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="surface flex flex-wrap items-center gap-4 p-5">
        <div className="flex size-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground">
          <LifeBuoy className="size-5" />
        </div>
        <div className="min-w-[220px] flex-1">
          <h2 className="font-display text-lg font-semibold">Help &amp; contact</h2>
          <p className="text-sm text-muted-foreground">
            A question about publishing, keywords or billing? Send it here — it lands straight in our support inbox.
          </p>
        </div>
        <div className="flex flex-wrap gap-4 text-[12px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Mail className="size-3.5 text-primary" /> support@autopilotgeo.com
          </span>
          <span className="flex items-center gap-1.5">
            <Clock className="size-3.5 text-amber-500" /> Reply within 24h
          </span>
        </div>
      </div>

      <form onSubmit={submit} className="surface max-w-2xl space-y-4 p-5">
        <div>
          <Label htmlFor="support-email">Your email</Label>
          <Input
            id="support-email"
            type="email"
            maxLength={255}
            required
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            className="mt-1.5"
          />
        </div>
        <div>
          <Label htmlFor="support-subject">Subject</Label>
          <Input
            id="support-subject"
            maxLength={120}
            required
            placeholder="e.g. WordPress publishing fails"
            value={form.subject}
            onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
            className="mt-1.5"
          />
        </div>
        <div>
          <Label htmlFor="support-message">How can we help?</Label>
          <Textarea
            id="support-message"
            maxLength={4000}
            required
            rows={7}
            placeholder="Describe what you were doing and what happened."
            value={form.message}
            onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
            className="mt-1.5"
          />
          <p className="mt-1 text-right text-[11px] text-muted-foreground">{form.message.length}/4000</p>
        </div>
        <Button type="submit" disabled={busy} className="gap-2 bg-deep text-background hover:bg-deep/90">
          <Send className="size-4" /> {busy ? "Sending…" : "Send message"}
        </Button>
      </form>
    </div>
  );
}