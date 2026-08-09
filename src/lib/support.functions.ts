import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const submitSupportTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        email: z.string().trim().email().max(255),
        subject: z.string().trim().min(3).max(120),
        message: z.string().trim().min(10).max(4000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { sendMail, supportTicketHtml, SUPPORT_INBOX, ADMIN_ALERT_INBOX } = await import("./mailer.server");
    const { supabase, userId } = context;

    const { error } = await supabase.from("support_tickets").insert({
      user_id: userId,
      email: data.email,
      subject: data.subject,
      message: data.message,
    });
    if (error) throw new Error(error.message);

    const notified = await sendMail({
      to: [SUPPORT_INBOX, ADMIN_ALERT_INBOX],
      subject: `[Support] ${data.subject}`,
      html: supportTicketHtml({ ...data, userId }),
      replyTo: data.email,
    });

    return { ok: true, emailed: notified.sent, emailError: notified.error ?? null };
  });

export const notifySignup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { sendMail, signupHtml, SUPPORT_INBOX, ADMIN_ALERT_INBOX } = await import("./mailer.server");
    const { supabase, userId, claims } = context;
    const email = (claims as { email?: string } | null)?.email ?? "unknown";

    const { data: existing } = await supabase
      .from("signup_notifications")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (existing) return { notified: false, reason: "already_notified" as const };

    const { error } = await supabase
      .from("signup_notifications")
      .insert({ user_id: userId, email });
    if (error) return { notified: false, reason: "insert_failed" as const };

    await sendMail({
      to: [SUPPORT_INBOX, ADMIN_ALERT_INBOX],
      subject: `New signup — ${email}`,
      html: signupHtml({ email, userId, when: new Date().toISOString() }),
    });

    return { notified: true, reason: "sent" as const };
  });