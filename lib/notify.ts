/**
 * Server-side notification helpers for SOS alerts and contact verification.
 *
 * WhatsApp (Meta Cloud API) is the primary channel; email (Resend) is the
 * fallback when a contact has no phone number. All calls are safe no-ops
 * when the credentials aren't configured yet, so the app still runs in a
 * fresh checkout — set them manually in .env.local / Vercel to enable.
 */

const WHATSAPP_GRAPH_VERSION = "v18.0";

/** Meta's Messages API expects digits only (E.164 without + / spaces). */
export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

export function generateVerificationCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * Send a plain-text WhatsApp message via Meta's Cloud API.
 * Returns { ok, detail } — never throws.
 */
export async function sendWhatsAppMessage(
  phone: string,
  text: string
): Promise<{ ok: boolean; detail: string }> {
  const token = process.env.WHATSAPP_TOKEN ?? "";
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID ?? "";
  if (!token || !phoneNumberId) {
    return { ok: false, detail: "WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID not configured" };
  }

  const to = normalizePhone(phone);
  if (!to) return { ok: false, detail: "empty phone number" };

  try {
    const res = await fetch(
      `https://graph.facebook.com/${WHATSAPP_GRAPH_VERSION}/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { preview_url: false, body: text },
        }),
      }
    );

    if (!res.ok) {
      const body = await res.text();
      return { ok: false, detail: `WhatsApp ${res.status}: ${body.slice(0, 300)}` };
    }
    return { ok: true, detail: `WhatsApp delivered to +${to}` };
  } catch (err) {
    return {
      ok: false,
      detail: `WhatsApp request failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Send an email via Resend's API (free tier). Returns { ok, detail }.
 */
export async function sendResendEmail(
  email: string,
  subject: string,
  text: string
): Promise<{ ok: boolean; detail: string }> {
  const apiKey = process.env.RESEND_API_KEY ?? "";
  if (!apiKey) return { ok: false, detail: "RESEND_API_KEY not configured" };
  if (!email) return { ok: false, detail: "empty email address" };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // Keep the free-tier approved sender so no domain setup is needed.
        from: "Sentinel <onboarding@resend.dev>",
        to: [email],
        subject,
        text,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      return { ok: false, detail: `Resend ${res.status}: ${body.slice(0, 300)}` };
    }
    return { ok: true, detail: `Email delivered to ${email}` };
  } catch (err) {
    return {
      ok: false,
      detail: `Resend request failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}