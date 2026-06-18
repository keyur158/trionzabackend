import axios from 'axios';
import { env } from '../config/env';

// Region-dependent: .com (US), .eu (Europe), .in (India). Configurable via env.
const ZEPTOMAIL_API = `${env.ZEPTOMAIL_API_BASE}/v1.1/email`;

function otpEmailHtml(code: string): string {
  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#E8D8C4;font-family:Helvetica,Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#E8D8C4;padding:32px 0;">
      <tr>
        <td align="center">
          <table width="440" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #E5E7EB;">
            <tr>
              <td style="background:#561C24;padding:28px 32px;text-align:center;">
                <span style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:2px;">TRIONZA DIAMOND</span>
              </td>
            </tr>
            <tr>
              <td style="padding:36px 32px 8px 32px;">
                <h1 style="margin:0;color:#561C24;font-size:20px;font-weight:700;">Your verification code</h1>
                <p style="margin:12px 0 0 0;color:#6B7280;font-size:14px;line-height:22px;">
                  Use the code below to continue. It expires in 10 minutes. If you didn't request this, you can ignore this email.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 8px 32px;" align="center">
                <div style="display:inline-block;background:#E8D8C4;border-radius:12px;padding:18px 28px;">
                  <span style="color:#561C24;font-size:38px;font-weight:700;letter-spacing:12px;">${code}</span>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 36px 32px;">
                <p style="margin:0;color:#9CA3AF;font-size:12px;line-height:18px;text-align:center;">
                  &copy; Trionza Diamond. This is an automated message, please do not reply.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * Sends a 6-digit OTP to the given email via ZeptoMail.
 * If ZEPTOMAIL_TOKEN is not configured, the code is logged to the console so the
 * flow remains testable in development without real credentials.
 */
export async function sendOtpEmail(email: string, code: string): Promise<void> {
  if (!env.ZEPTOMAIL_TOKEN) {
    console.log(`[email] ZEPTOMAIL_TOKEN not set — OTP for ${email}: ${code}`);
    return;
  }

  try {
    await axios.post(
      ZEPTOMAIL_API,
      {
        from: { address: env.ZEPTOMAIL_FROM_ADDRESS, name: env.ZEPTOMAIL_FROM_NAME },
        to: [{ email_address: { address: email } }],
        subject: 'Your Trionza Diamond verification code',
        htmlbody: otpEmailHtml(code),
      },
      {
        headers: {
          // Tolerate a token pasted with or without the "Zoho-enczapikey " prefix.
          Authorization: env.ZEPTOMAIL_TOKEN.startsWith('Zoho-enczapikey')
            ? env.ZEPTOMAIL_TOKEN
            : `Zoho-enczapikey ${env.ZEPTOMAIL_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (err) {
    const detail = axios.isAxiosError(err) ? JSON.stringify(err.response?.data ?? err.message) : String(err);
    console.error(`[email] ZeptoMail send failed for ${email}: ${detail}`);
    throw new Error('Failed to send verification email');
  }
}