/**
 * Firebase Cloud Messaging (HTTP v1) sender for Edge Functions.
 *
 * Secrets (deployed via `supabase secrets set`):
 *   SERVICE_ACCOUNT_JSON — full Firebase service-account JSON (base64 or raw)
 *   PUBLIC_APP_URL       — e.g. https://sentinel.app
 */

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function getServiceAccount(): Record<string, string> {
  const raw = Deno.env.get("SERVICE_ACCOUNT_JSON");
  if (!raw) throw new Error("SERVICE_ACCOUNT_JSON not set");
  return JSON.parse(raw) as Record<string, string>;
}

/** Exchanges the service account for a short-lived OAuth access token. */
async function getAccessToken(): Promise<string> {
  const sa = getServiceAccount();
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: sa.client_email,
    scope: FCM_SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const enc = (o: Record<string, unknown>) =>
    base64UrlEncode(new TextEncoder().encode(JSON.stringify(o)));
  const signingInput = `${enc(header)}.${enc(claims)}`;

  const pkcs8 = atob(
    sa.private_key
      .replace("-----BEGIN PRIVATE KEY-----", "")
      .replace("-----END PRIVATE KEY-----", "")
      .replace(/\s/g, "")
  );
  const keyData = new Uint8Array(pkcs8.length);
  for (let i = 0; i < pkcs8.length; i++) keyData[i] = pkcs8.charCodeAt(i);

  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput)
  );
  const jwt = `${signingInput}.${base64UrlEncode(new Uint8Array(sig))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

export interface FcmMessage {
  token: string;
  title: string;
  body: string;
  /** Extra structured data delivered to the service worker. */
  data?: Record<string, string>;
  /** URL the notification should open (web). */
  url?: string;
}

export async function sendFcm(msg: FcmMessage): Promise<boolean> {
  try {
    const sa = getServiceAccount();
    const token = await getAccessToken();
    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token: msg.token,
            notification: { title: msg.title, body: msg.body },
            data: msg.data ?? {},
            webpush: msg.url
              ? { fcm_options: { link: msg.url } }
              : undefined,
          },
        }),
      }
    );
    if (!res.ok) {
      console.error(`FCM send failed (${res.status}): ${await res.text()}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("FCM send error:", err);
    return false;
  }
}

/**
 * SMS fallback — the code path exists but is intentionally NOT wired to a
 * paid provider. Production would send via Twilio (or similar) using the
 * contact's phone number.
 */
export function smsFallback(phone: string, body: string): void {
  console.warn(
    `[SMS-FALLBACK-DEMO] Would text ${phone}: ${body} — Twilio not configured`
  );
}
