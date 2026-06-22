import admin from 'firebase-admin';
import { getFirebaseApp } from '../config/firebase';

const TITLES = {
  confirmed: 'Order Confirmed!',
  shipped: 'Your Order Shipped!',
  delivered: 'Order Delivered!',
} as const;

const BODIES = {
  confirmed: (n: string) => `Your order #${n} has been confirmed.`,
  shipped: (n: string) => `Your order #${n} is on its way!`,
  delivered: (n: string) => `Your order #${n} has been delivered.`,
} as const;

export type PushType = keyof typeof TITLES;

export async function sendOrderPush(tokens: string[], type: PushType, orderNumber: string): Promise<void> {
  if (tokens.length === 0) return;
  try {
    const messaging = admin.messaging(getFirebaseApp());
    await messaging.sendEachForMulticast({
      tokens,
      notification: {
        title: TITLES[type],
        body: BODIES[type](orderNumber),
      },
      data: { orderNumber, type },
    });
  } catch (err) {
    console.error('FCM push error:', err);
  }
}

/** Sends an arbitrary notification to many tokens in chunks of 500 (FCM limit). */
export async function sendPushToTokens(
  tokens: string[],
  title: string,
  body: string,
  data: Record<string, string> = {},
): Promise<{ successCount: number; failureCount: number }> {
  if (tokens.length === 0) return { successCount: 0, failureCount: 0 };
  const messaging = admin.messaging(getFirebaseApp());
  let successCount = 0;
  let failureCount = 0;
  for (let i = 0; i < tokens.length; i += 500) {
    const batch = tokens.slice(i, i + 500);
    const resp = await messaging.sendEachForMulticast({
      tokens: batch,
      notification: { title, body },
      data,
    });
    successCount += resp.successCount;
    failureCount += resp.failureCount;
  }
  return { successCount, failureCount };
}
