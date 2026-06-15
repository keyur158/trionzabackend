import { Router, Request, Response } from 'express';
import { verifyShopifyWebhook } from '../middleware/webhook-verify';
import { prisma } from '../config/database';
import { upsertProduct, deleteProduct } from '../services/product-sync';
import { updateOrderFromWebhook } from '../services/shopify-order';
import { sendOrderPush } from '../services/push';

const router = Router();

router.post('/', verifyShopifyWebhook, async (req: Request, res: Response) => {
  const topic = req.headers['x-shopify-topic'] as string;
  const eventId = req.headers['x-shopify-webhook-id'] as string;

  // Respond 200 immediately
  res.status(200).send('OK');

  // Deduplicate
  try {
    await prisma.webhookEvent.create({ data: { eventId, topic } });
  } catch {
    return;
  }

  const payload = JSON.parse((req.body as Buffer).toString()) as Record<string, unknown>;

  try {
    switch (topic) {
      case 'products/create':
      case 'products/update':
        await upsertProduct(payload as never);
        break;

      case 'products/delete':
        await deleteProduct(String(payload.id));
        break;

      case 'orders/updated':
        await updateOrderFromWebhook(payload);
        break;

      case 'orders/fulfilled': {
        await updateOrderFromWebhook(payload);
        const order = await prisma.order.findFirst({
          where: { shopifyOrderId: String(payload.id) },
          include: { customer: { include: { deviceTokens: true } } },
        });
        if (order) {
          const tokens = order.customer.deviceTokens.map(dt => dt.fcmToken);
          if (tokens.length > 0) await sendOrderPush(tokens, 'shipped', order.orderNumber);
        }
        break;
      }

      case 'customers/create':
        // Customer sync is handled server-side during signup
        break;

      default:
        console.log(`Unhandled webhook topic: ${topic}`);
    }
  } catch (err) {
    console.error(`Webhook handler error [${topic}]:`, err);
  }
});

export default router;
