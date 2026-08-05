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
/** Spacing between posts; Google Chat rate-limits webhooks per space. */
const INTER_MESSAGE_DELAY_MS = 1_000;

/**
 * Post a sequence of messages, in order.
 *
 * Success is **all-or-nothing**: the caller purges the buffer only when every
 * message landed. A partial failure therefore resends the whole sequence next
 * run, which can duplicate lines — a deliberate trade, since duplicated
 * changelog entries are recoverable and a silently lost changelog is not.
 */
export async function sendToGoogleChat(
  messages: ChatMessage[],
  opts: { dryRun: boolean; webhookUrl?: string },
): Promise<SendResult> {
  if (messages.length === 0) return { sent: false, reason: "nothing to send" };

  if (opts.dryRun) {
    console.log(`[send] DRY_RUN — ${messages.length} message(s) that would be posted:`);
    for (const message of messages) console.log(JSON.stringify(message, null, 2));
    return { sent: false, reason: "dry-run" };
  }

  if (!opts.webhookUrl) {
    throw new Error("GOOGLE_CHAT_WEBHOOK_URL is not set (and DRY_RUN is not enabled)");
  }

  for (const [index, message] of messages.entries()) {
    const payload = JSON.stringify(message);
    // TextEncoder rather than Buffer — Workers has no Node Buffer global.
    const bytes = new TextEncoder().encode(payload).length;

    if (bytes > MAX_PAYLOAD_BYTES) {
      console.warn(`[send] message ${index + 1} is ${bytes} bytes, above the ${MAX_PAYLOAD_BYTES} limit`);
    }

    if (index > 0) await sleep(INTER_MESSAGE_DELAY_MS);

    const res = await fetch(opts.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: payload,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // Surface which message failed: everything before it was delivered, so a
      // retry will duplicate those.
      throw new Error(
        `Google Chat webhook returned ${res.status} on message ${index + 1}/${messages.length}: ` +
          body.slice(0, 300),
      );
    }

    console.log(`[send] posted message ${index + 1}/${messages.length} (${bytes} bytes)`);
  }

  return { sent: true };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
