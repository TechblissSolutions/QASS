import 'server-only';

/** Shared transactional email sender backed exclusively by ZeptoMail. */
export async function sendTransactionalEmail(to: string, subject: string, html: string) {
  const token = process.env.ZEPTOMAIL_API_TOKEN?.trim();
  const fromAddress = process.env.ZEPTOMAIL_FROM_EMAIL?.trim();
  const fromName = process.env.ZEPTOMAIL_FROM_NAME?.trim() || 'QASS Notifications';
  const bounceAddress = process.env.ZEPTOMAIL_BOUNCE_ADDRESS?.trim();
  if (!token || !fromAddress || !bounceAddress) {
    return { sent: false, reason: 'zeptomail_not_configured' as const };
  }

  try {
    const response = await fetch('https://api.zeptomail.com/v1.1/email', {
      method: 'POST',
      headers: {
        Authorization: `Zoho-enczapikey ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bounce_address: bounceAddress,
        from: { address: fromAddress, name: fromName },
        to: [{ email_address: { address: to } }],
        subject,
        htmlbody: html,
      }),
      cache: 'no-store',
    });
    if (!response.ok) return { sent: false, reason: `zeptomail_error_${response.status}` as const };
    return { sent: true as const };
  } catch {
    // Email is best-effort and must not undo a successful schedule/job update.
    return { sent: false, reason: 'zeptomail_network_error' as const };
  }
}

export function emailShell(title: string, body: string) {
  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#202124"><h2>${escapeHtml(title)}</h2><div>${body}</div><hr style="border:0;border-top:1px solid #eee;margin-top:28px"><p style="color:#777;font-size:12px">QASS account notification. If you did not initiate this activity, secure your account.</p></div>`;
}
export function escapeHtml(value: unknown) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!)); }
