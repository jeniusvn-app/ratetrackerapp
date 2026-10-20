const BOT_TOKEN = (import.meta.env.VITE_TELEGRAM_BOT_TOKEN as string | undefined) || '8785788999:AAF8-r0HFR0izfXDwEtRCEuJkCEqqhT6P-A';
const CHAT_ID = (import.meta.env.VITE_TELEGRAM_CHAT_ID as string | undefined) || '-5349078525';

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

export interface RateRequestNotificationData {
  hotel_name: string;
  room_type?: string;
  effective_date: string;
  old_rate?: string | number | null;
  new_rate?: string | number | null;
  requested_by: string;
  reason?: string | null;
  created_at?: string;
}

export async function sendRateRequestTelegramNotification(
  data: RateRequestNotificationData,
): Promise<{ ok: boolean; error: string | null }> {
  const created = data.created_at ? new Date(data.created_at).toLocaleString('vi-VN') : new Date().toLocaleString('vi-VN');
  const oldRate = data.old_rate != null ? `${Number(data.old_rate).toLocaleString('vi-VN')} VNĐ` : '—';
  const newRate = data.new_rate != null ? `${Number(data.new_rate).toLocaleString('vi-VN')} VNĐ` : '—';
  const roomType = data.room_type || '—';
  const reason = data.reason || '—';

  const message =
    `🔔 <b>YÊU CẦU CHỈNH GIÁ MỚI</b>\n` +
    `• Khách sạn: <b>${data.hotel_name}</b>\n` +
    `• Loại phòng: <b>${roomType}</b>\n` +
    `• Ngày áp dụng: <b>${data.effective_date}</b>\n` +
    `• Thay đổi giá: <code>${oldRate}</code> ➡️ <code>${newRate}</code>\n` +
    `• Người yêu cầu: <b>${data.requested_by}</b>\n` +
    `• Lý do: <i>${reason}</i>\n` +
    `• Thời gian gửi: <i>${created}</i>`;

  return sendTelegramMessage(message);
}
