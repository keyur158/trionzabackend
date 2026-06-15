import axios from 'axios';
import { env } from '../config/env';

const PAYPAL_BASE = env.PAYPAL_MODE === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

async function getAccessToken(): Promise<string> {
  const auth = Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_SECRET}`).toString('base64');
  const res = await axios.post(
    `${PAYPAL_BASE}/v1/oauth2/token`,
    'grant_type=client_credentials',
    { headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  return res.data.access_token as string;
}

export interface PayPalCreateOrderResult {
  id: string;
  approveUrl: string;
}

export async function createPayPalOrder(
  amount: string,
  currency: string,
  returnUrl: string,
  cancelUrl: string
): Promise<PayPalCreateOrderResult> {
  const token = await getAccessToken();
  const res = await axios.post(
    `${PAYPAL_BASE}/v2/checkout/orders`,
    {
      intent: 'CAPTURE',
      purchase_units: [{ amount: { currency_code: currency, value: amount } }],
      application_context: {
        return_url: returnUrl,
        cancel_url: cancelUrl,
        user_action: 'PAY_NOW',
        shipping_preference: 'NO_SHIPPING',
      },
    },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  const links: Array<{ rel: string; href: string }> = res.data.links ?? [];
  const approve = links.find((l) => l.rel === 'approve' || l.rel === 'payer-action');
  if (!approve) throw new Error('PayPal approval link missing');
  return { id: res.data.id as string, approveUrl: approve.href };
}

export interface PayPalCaptureResult {
  status: string;
  transactionId: string;
  amount: string;
  raw: unknown;
}

export async function capturePayPalPayment(paypalOrderId: string): Promise<PayPalCaptureResult> {
  const token = await getAccessToken();
  const res = await axios.post(
    `${PAYPAL_BASE}/v2/checkout/orders/${paypalOrderId}/capture`,
    {},
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  const capture = res.data.purchase_units[0].payments.captures[0];
  return {
    status: res.data.status as string,
    transactionId: capture.id as string,
    amount: capture.amount.value as string,
    raw: res.data,
  };
}
