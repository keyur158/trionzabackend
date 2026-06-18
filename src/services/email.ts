import axios from 'axios';
import { env } from '../config/env';

// Region-dependent: .com (US), .eu (Europe), .in (India). Configurable via env.
const ZEPTOMAIL_API = `${env.ZEPTOMAIL_API_BASE}/v1.1/email`;

// ---------------------------------------------------------------------------
// Low-level send
// ---------------------------------------------------------------------------

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  // When set, replies go to the customer instead of the no-reply mailbox.
  replyTo?: { address: string; name?: string };
}

/**
 * Sends one email via ZeptoMail. If ZEPTOMAIL_TOKEN is not configured the email
 * is logged to the console (returns false) so flows stay testable in
 * development without real credentials. Throws on a genuine API failure.
 */
async function sendEmail(opts: SendEmailOptions): Promise<boolean> {
  if (!env.ZEPTOMAIL_TOKEN) {
    console.log(`[email] ZEPTOMAIL_TOKEN not set — would send "${opts.subject}" to ${opts.to}`);
    return false;
  }

  await axios.post(
    ZEPTOMAIL_API,
    {
      from: { address: env.ZEPTOMAIL_FROM_ADDRESS, name: env.ZEPTOMAIL_FROM_NAME },
      to: [{ email_address: { address: opts.to } }],
      ...(opts.replyTo
        ? { reply_to: [{ address: opts.replyTo.address, name: opts.replyTo.name }] }
        : {}),
      subject: opts.subject,
      htmlbody: opts.html,
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
  return true;
}

// ---------------------------------------------------------------------------
// Shared HTML building blocks (brand palette: #561C24 primary, #E8D8C4 sand)
// ---------------------------------------------------------------------------

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function emailLayout(opts: {
  heading: string;
  intro: string;
  rowsHtml: string;
  footerNote?: string;
}): string {
  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#E8D8C4;font-family:Helvetica,Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#E8D8C4;padding:32px 0;">
      <tr>
        <td align="center">
          <table width="460" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #E5E7EB;">
            <tr>
              <td style="background:#561C24;padding:28px 32px;text-align:center;">
                <span style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:2px;">TRIONZA DIAMOND</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 32px 4px 32px;">
                <h1 style="margin:0;color:#561C24;font-size:20px;font-weight:700;">${opts.heading}</h1>
                <p style="margin:12px 0 0 0;color:#6B7280;font-size:14px;line-height:22px;">${opts.intro}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 8px 32px;">
                <table width="100%" cellpadding="0" cellspacing="0" style="background:#FAF6F2;border-radius:12px;border:1px solid #EFE3D6;">
                  ${opts.rowsHtml}
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 36px 32px;">
                <p style="margin:0;color:#9CA3AF;font-size:12px;line-height:18px;text-align:center;">
                  ${opts.footerNote ?? '&copy; Trionza Diamond.'}
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

function detailRows(rows: Array<[string, unknown]>): string {
  return rows
    .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
    .map(
      ([label, v]) => `
      <tr>
        <td style="padding:11px 16px;border-bottom:1px solid #EFE3D6;color:#8A7A6B;font-size:12px;font-weight:600;width:38%;vertical-align:top;">${esc(
          label
        )}</td>
        <td style="padding:11px 16px;border-bottom:1px solid #EFE3D6;color:#561C24;font-size:13px;font-weight:600;">${esc(
          v
        )}</td>
      </tr>`
    )
    .join('');
}

// ---------------------------------------------------------------------------
// OTP email
// ---------------------------------------------------------------------------

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
    await sendEmail({
      to: email,
      subject: 'Your Trionza Diamond verification code',
      html: otpEmailHtml(code),
    });
  } catch (err) {
    const detail = axios.isAxiosError(err) ? JSON.stringify(err.response?.data ?? err.message) : String(err);
    console.error(`[email] ZeptoMail send failed for ${email}: ${detail}`);
    throw new Error('Failed to send verification email');
  }
}

// ---------------------------------------------------------------------------
// Virtual appointment requests
// ---------------------------------------------------------------------------

export interface AppointmentData {
  name: string;
  phone: string;
  email: string;
  date: string;
  time: string;
  purpose: string;
}

/**
 * Sends a thank-you to the customer AND a notification to the admin inbox for a
 * virtual appointment request. Resilient: a failure on one email is logged but
 * does not prevent the other from sending.
 */
export async function sendAppointmentEmails(data: AppointmentData): Promise<void> {
  const rows = detailRows([
    ['Name', data.name],
    ['Phone', data.phone],
    ['Email', data.email],
    ['Date', data.date],
    ['Time', data.time],
    ['Purpose', data.purpose],
  ]);

  const customerHtml = emailLayout({
    heading: 'Your appointment request is received',
    intro:
      'Thank you for booking a virtual session with Trionza Diamond. Our team will confirm your slot within 24 hours. Here is a summary of your request:',
    rowsHtml: rows,
    footerNote: '&copy; Trionza Diamond. We look forward to meeting you.',
  });

  const adminHtml = emailLayout({
    heading: 'New virtual appointment request',
    intro: 'A customer has requested a virtual appointment. Details below:',
    rowsHtml: rows,
    footerNote: 'Reply directly to this email to reach the customer.',
  });

  const results = await Promise.allSettled([
    sendEmail({
      to: data.email,
      subject: "We've received your appointment request — Trionza Diamond",
      html: customerHtml,
    }),
    sendEmail({
      to: env.ADMIN_EMAIL,
      subject: `New Virtual Appointment Request — ${data.name}`,
      html: adminHtml,
      replyTo: { address: data.email, name: data.name },
    }),
  ]);

  logEmailResults('appointment', data.email, results);
}

// ---------------------------------------------------------------------------
// Custom order requests
// ---------------------------------------------------------------------------

export interface CustomOrderData {
  name: string;
  phone: string;
  email: string;
  jewelleryType: string;
  metal?: string;
  metalColor?: string;
  stone?: string;
  ctWeight?: string | number;
  diamondColor?: string;
  size?: string;
  description?: string;
  budget?: string | number;
  deliveryDate?: string;
  hasReferenceImage?: boolean;
}

/**
 * Sends a thank-you to the customer AND a notification to the admin inbox for a
 * custom order request. Resilient: a failure on one email is logged but does
 * not prevent the other from sending.
 */
export async function sendCustomOrderEmails(data: CustomOrderData): Promise<void> {
  const rows = detailRows([
    ['Name', data.name],
    ['Phone', data.phone],
    ['Email', data.email],
    ['Jewellery Type', data.jewelleryType],
    ['Metal', data.metal],
    ['Metal Color', data.metalColor],
    ['Stone', data.stone],
    ['Carat Weight', data.ctWeight != null ? `${data.ctWeight} CT` : undefined],
    ['Diamond Color', data.diamondColor],
    ['Size / Measurements', data.size],
    ['Budget', data.budget != null ? `$${data.budget}` : undefined],
    ['Preferred Delivery', data.deliveryDate],
    ['Design Description', data.description],
    ['Reference Image', data.hasReferenceImage ? 'Yes — customer uploaded a reference image' : undefined],
  ]);

  const customerHtml = emailLayout({
    heading: 'Thank you for your custom order request',
    intro:
      'We have received your custom design request and our jewellers will review it and contact you within 24 hours. Here is a summary of what you submitted:',
    rowsHtml: rows,
    footerNote: '&copy; Trionza Diamond. Let\'s craft something beautiful together.',
  });

  const adminHtml = emailLayout({
    heading: 'New custom order request',
    intro: 'A customer has submitted a custom order. Details below:',
    rowsHtml: rows,
    footerNote: 'Reply directly to this email to reach the customer.',
  });

  const results = await Promise.allSettled([
    sendEmail({
      to: data.email,
      subject: 'Thank you for your custom order request — Trionza Diamond',
      html: customerHtml,
    }),
    sendEmail({
      to: env.ADMIN_EMAIL,
      subject: `New Custom Order Request — ${data.name}`,
      html: adminHtml,
      replyTo: { address: data.email, name: data.name },
    }),
  ]);

  logEmailResults('custom-order', data.email, results);
}

// ---------------------------------------------------------------------------

function logEmailResults(
  kind: string,
  customerEmail: string,
  results: PromiseSettledResult<boolean>[]
): void {
  const [customer, admin] = results;
  if (customer?.status === 'rejected') {
    const detail = axios.isAxiosError(customer.reason)
      ? JSON.stringify(customer.reason.response?.data ?? customer.reason.message)
      : String(customer.reason);
    console.error(`[email] ${kind} customer email failed for ${customerEmail}: ${detail}`);
  }
  if (admin?.status === 'rejected') {
    const detail = axios.isAxiosError(admin.reason)
      ? JSON.stringify(admin.reason.response?.data ?? admin.reason.message)
      : String(admin.reason);
    console.error(`[email] ${kind} admin email failed (to ${env.ADMIN_EMAIL}): ${detail}`);
  }
}
