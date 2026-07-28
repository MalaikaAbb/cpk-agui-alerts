import type { ChatMessage } from "./chatCard.js";

/** Google Chat rejects webhook payloads above 32 KB. */
const MAX_PAYLOAD_BYTES = 32_000;

export interface SendResult {
  sent: boolean;
  reason?: string;
}

/**
 * POST the report to the Google Chat webhook, or print it when DRY_RUN is set.
 *
 * Dry-run prints the exact payload that would be sent so the card can be checked
 * (and pasted into Chat's card builder) before any webhook is wired up.
 */
export async function sendToGoogleChat(
  message: ChatMessage,
  opts: { dryRun: boolean; webhookUrl?: string },
): Promise<SendResult> {
  const payload = JSON.stringify(message);
  // TextEncoder rather than Buffer — Workers has no Node Buffer global.
  const bytes = new TextEncoder().encode(payload).length;

  if (bytes > MAX_PAYLOAD_BYTES) {
    // Section caps make this unlikely; log loudly rather than fail the run.
    console.warn(`[send] payload is ${bytes} bytes, above the ${MAX_PAYLOAD_BYTES} limit`);
  }

  if (opts.dryRun) {
    console.log("[send] DRY_RUN — payload that would be posted:");
    console.log(JSON.stringify(message, null, 2));
    return { sent: false, reason: "dry-run" };
  }

  if (!opts.webhookUrl) {
    throw new Error("GOOGLE_CHAT_WEBHOOK_URL is not set (and DRY_RUN is not enabled)");
  }

  const res = await fetch(opts.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: payload,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Google Chat webhook returned ${res.status}: ${body.slice(0, 300)}`);
  }

  console.log(`[send] posted to Google Chat (${bytes} bytes)`);
  return { sent: true };
}
