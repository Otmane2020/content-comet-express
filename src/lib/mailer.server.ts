const RESEND_ENDPOINT = "https://api.resend.com/emails";

export const SUPPORT_INBOX = "support@ranki.ai";
export const ADMIN_ALERT_INBOX = "oben.rockman@gmail.com";
const FROM = "Ranki.ai <support@ranki.ai>";

export async function sendMail(opts: {
  to: string[];
  subject: string;
  html: string;
  replyTo?: string;
}): Promise<{ sent: boolean; error?: string }> {
  const key = process.env["RESEND_API_KEY"];
  if (!key) return { sent: false, error: "RESEND_API_KEY is not configured" };

  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      from: FROM,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`Resend request failed [${res.status}]: ${body}`);
    return { sent: false, error: `Email provider error [${res.status}]: ${body}` };
  }
  return { sent: true };
}

const esc = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function supportTicketHtml(t: {
  email: string;
  subject: string;
  message: string;
  userId: string;
}) {
  return `<div style="font-family:Arial,sans-serif;color:#111">
    <h2 style="margin:0 0 12px">New support request</h2>
    <p style="margin:0 0 6px"><strong>From:</strong> ${esc(t.email)}</p>
    <p style="margin:0 0 6px"><strong>Subject:</strong> ${esc(t.subject)}</p>
    <p style="margin:0 0 16px;color:#666"><strong>User ID:</strong> ${esc(t.userId)}</p>
    <div style="white-space:pre-wrap;border-left:3px solid #4f46e5;padding:8px 14px;background:#f7f7fb">${esc(t.message)}</div>
  </div>`;
}

export function signupHtml(t: { email: string; userId: string; when: string }) {
  return `<div style="font-family:Arial,sans-serif;color:#111">
    <h2 style="margin:0 0 12px">New Ranki.ai signup</h2>
    <p style="margin:0 0 6px"><strong>Email:</strong> ${esc(t.email)}</p>
    <p style="margin:0 0 6px"><strong>User ID:</strong> ${esc(t.userId)}</p>
    <p style="margin:0;color:#666"><strong>Signed up:</strong> ${esc(t.when)}</p>
  </div>`;
}