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
