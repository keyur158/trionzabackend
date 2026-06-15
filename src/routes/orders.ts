import { Router, Request, Response } from 'express';
import { prisma } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { createShopifyOrder } from '../services/shopify-order';
import { createOrFindShopifyCustomer } from '../services/shopify-customer';

const router = Router();

router.get('/', requireAuth, async (req: Request, res: Response) => {
  const orders = await prisma.order.findMany({
    where: { customerId: req.user!.id },
    orderBy: { createdAt: 'desc' },
    include: { payments: { select: { paymentMethod: true, status: true, amount: true } } },
  });
  res.json({ orders });
});

router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  const order = await prisma.order.findFirst({
    where: { id: req.params.id as string, customerId: req.user!.id },
    include: { payments: true },
  });
  if (!order) {
    res.status(404).json({ message: 'Order not found' });
    return;
  }
  res.json({ order });
});

router.post('/:id/sync-shopify', requireAuth, async (req: Request, res: Response) => {
  const order = await prisma.order.findFirst({
    where: { id: req.params.id as string, customerId: req.user!.id },
  });
  if (!order) {
    res.status(404).json({ message: 'Order not found' });
    return;
  }
  if (order.shopifyOrderId) {
    res.json({ success: true, shopifyOrderId: order.shopifyOrderId, alreadySynced: true });
    return;
  }

  const customer = await prisma.customer.findUnique({ where: { id: req.user!.id } });
  if (!customer) {
    res.status(404).json({ message: 'Customer not found' });
    return;
  }

  let shopifyCustomerId = customer.shopifyCustomerId;
  if (!shopifyCustomerId) {
    shopifyCustomerId = await createOrFindShopifyCustomer({
      email: customer.email,
      firstName: customer.firstName ?? undefined,
      lastName: customer.lastName ?? undefined,
      phone: customer.phone ?? undefined,
    });
    if (shopifyCustomerId) {
      await prisma.customer.update({ where: { id: customer.id }, data: { shopifyCustomerId } });
    }
  }

  if (!shopifyCustomerId) {
    res.status(400).json({ message: 'Could not create Shopify customer account' });
    return;
  }

  const lineItems = order.lineItems as Array<{ variantId: string; quantity: number }>;
  const shippingAddress = order.shippingAddress as {
    address1: string; address2?: string | null; city: string;
    province?: string | null; country: string; zip: string;
  };

  const shopifyOrder = await createShopifyOrder({
    lineItems: lineItems.map(li => ({ variantId: li.variantId, quantity: li.quantity })),
    shopifyCustomerId,
    customerEmail: order.customerEmail,
    shippingAddress,
    totalPrice: Number(order.totalPrice).toFixed(2),
    paypalTransactionId: `SYNC-${order.orderNumber}`,
  });

  if (!shopifyOrder) {
    res.status(500).json({ message: 'Shopify order creation failed — check server logs' });
    return;
  }

  const shopifyOrderId = shopifyOrder.id.split('/').pop()!;
  const shopifyOrderNumber = shopifyOrder.name.replace('#', '');
  await prisma.order.update({
    where: { id: order.id },
    data: { shopifyOrderId, shopifyCreatedAt: new Date(), orderNumber: shopifyOrderNumber },
  });

  res.json({ success: true, shopifyOrderId, orderNumber: shopifyOrderNumber });
});

export default router;
