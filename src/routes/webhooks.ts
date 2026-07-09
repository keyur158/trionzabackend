import { Router, Request, Response } from 'express';
import { verifyShopifyWebhook } from '../middleware/webhook-verify';
import { prisma } from '../config/database';
import { upsertProduct, deleteProduct } from '../services/product-sync';
import { updateOrderFromWebhook } from '../services/shopify-order';
import { sendOrderPush } from '../services/push';
import { syncSingleProduct } from '../services/shopify-sync';

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
      case 'products/update': {
        // The webhook payload carries raw metaobject GIDs (no label resolution);
        // re-fetch via GraphQL so metafield labels stay correct. On failure fall
        // back to the raw payload — its `metafields` is usually absent, so the
        // update path leaves existing resolved metafields untouched.
        try {
          const found = await syncSingleProduct(String(payload.id));
          if (!found) await upsertProduct(payload as never);
        } catch {
          await upsertProduct(payload as never);
        }
        break;
      }

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

      case 'fulfillment_events/create': {
        // Carrier tracking event; only final delivery matters here.
        if (payload.status !== 'delivered') break;
        const order = await prisma.order.findFirst({
          where: { shopifyOrderId: String(payload.order_id) },
          include: { customer: { include: { deviceTokens: true } } },
        });
        if (!order) {
          console.log(`fulfillment_events/create: no local order for ${payload.order_id}`);
          break;
        }
        await prisma.order.update({
          where: { id: order.id },
          data: { fulfillmentStatus: 'delivered', shopifyUpdatedAt: new Date() },
        });
        const tokens = order.customer.deviceTokens.map(dt => dt.fcmToken);
        if (tokens.length > 0) await sendOrderPush(tokens, 'delivered', order.orderNumber);
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
    // Processing failed — remove the dedup row (best-effort) so Shopify's
    // automatic retry of this event is not treated as a duplicate and lost.
    try {
      await prisma.webhookEvent.delete({ where: { eventId } });
    } catch (cleanupErr) {
      console.error(`Failed to remove dedup row for webhook ${eventId}:`, cleanupErr);
    }
  }
});

export default router;
