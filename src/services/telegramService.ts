const BOT_TOKEN = import.meta.env.VITE_TELEGRAM_BOT_TOKEN as string | undefined;
const CHAT_ID = import.meta.env.VITE_TELEGRAM_CHAT_ID as string | undefined;

let warned = false;

function warnOnce() {
  if (warned) return;
  warned = true;
  console.warn(
    '[telegram] VITE_TELEGRAM_BOT_TOKEN or VITE_TELEGRAM_CHAT_ID is not configured. Notifications will be skipped.',
  );
}

export async function sendTelegramMessage(text: string): Promise<{ ok: boolean; error: string | null }> {
  if (!BOT_TOKEN || !CHAT_ID) {
    warnOnce();
    return { ok: false, error: 'missing-config' };
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        parse_mode: 'HTML',
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.warn(`[telegram] sendMessage failed: ${res.status} ${body}`);
      return { ok: false, error: `${res.status} ${body}` };
    }
    return { ok: true, error: null };
  } catch (e) {
    console.warn(`[telegram] sendMessage error: ${(e as Error).message}`);
    return { ok: false, error: (e as Error).message };
  }
}
