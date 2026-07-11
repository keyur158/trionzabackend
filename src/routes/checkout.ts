import { Router, Request, Response } from 'express';
import { prisma } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { capturePayPalPayment, createPayPalOrder } from '../services/paypal';
import { env } from '../config/env';
import { createShopifyOrder } from '../services/shopify-order';
import { createOrFindShopifyCustomer } from '../services/shopify-customer';
import { sendOrderPush } from '../services/push';
import { validateShopifyDiscount, ValidatedDiscount } from '../services/shopify-discount';
import { computeDiscountAmount } from '../services/discount-apply';
import { sendPurchaseEvent, extractRequestContext } from '../services/meta-capi';

const router = Router();

interface Totals {
  subtotal: number;
  shipping: number;
  discount: number;
  tax: number;
  total: number;
}

async function computeTotals(customerId: string, shippingRateId: number, couponCode?: string): Promise<{
  totals: Totals;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cart: any;
  shippingRate: Awaited<ReturnType<typeof prisma.shippingRate.findUnique>>;
  discount: ValidatedDiscount | null;
}> {
  const cart = await prisma.cart.findUnique({
    where: { customerId },
    include: {
      items: {
        include: {
          variant: { select: { id: true, title: true, price: true, availableForSale: true, inventoryQty: true } },
          product: { select: { title: true, images: true } },
        },
      },
    },
  });

  if (!cart || cart.items.length === 0) throw new Error('Cart is empty');

  const subtotal = cart.items.reduce((sum, item) => sum + Number(item.variant.price) * item.quantity, 0);

  const shippingRate = await prisma.shippingRate.findUnique({ where: { id: shippingRateId } });
  if (!shippingRate || !shippingRate.isActive) throw new Error('Invalid shipping rate');

  if (shippingRate.minOrderValue && subtotal < Number(shippingRate.minOrderValue)) {
    throw new Error(`Minimum order of $${shippingRate.minOrderValue} required for this shipping option`);
  }

  const shipping = Number(shippingRate.price);

  let discountAmount = 0;
  let discount: ValidatedDiscount | null = null;
  if (couponCode) {
    const validation = await validateShopifyDiscount(String(couponCode).trim(), subtotal);
    if (!validation.ok) {
      // Invalid at calculate/pay time must fail loudly, not silently drop to 0 —
      // the user sees why before money moves.
      const err = new Error(validation.message) as Error & { statusCode?: number };
      err.statusCode = validation.status;
      throw err;
    }
    discount = validation.discount;
    discountAmount = await computeDiscountAmount(discount, cart.items.map((i: { productId: string; quantity: number; variant: { price: unknown } }) => ({
      productId: i.productId,
      price: Number(i.variant.price),
      quantity: i.quantity,
    })));
  }

  const tax = 0;
  const total = Math.max(0, subtotal + shipping - discountAmount + tax);

  return {
    totals: { subtotal, shipping, discount: discountAmount, tax, total },
    cart: cart as never,
    shippingRate,
    discount,
  };
}

router.post('/calculate', requireAuth, async (req: Request, res: Response) => {
  const { shippingRateId, couponCode } = req.body;
  if (!shippingRateId) {
    res.status(400).json({ message: 'shippingRateId is required' });
    return;
  }
  try {
    const { totals } = await computeTotals(req.user!.id, parseInt(shippingRateId), couponCode);
    res.json({
      subtotal: totals.subtotal.toFixed(2),
      shipping: totals.shipping.toFixed(2),
      discount: totals.discount.toFixed(2),
      tax: totals.tax.toFixed(2),
      total: totals.total.toFixed(2),
    });
  } catch (err: unknown) {
    const status = (err as { statusCode?: number })?.statusCode ?? 400;
    res.status(status).json({ message: err instanceof Error ? err.message : 'Calculation failed' });
    return;
  }
});

router.post('/validate-coupon', requireAuth, async (req: Request, res: Response) => {
  const { code } = req.body;
  if (!code) {
    res.status(400).json({ message: 'code is required' });
    return;
  }
  const cart = await prisma.cart.findUnique({
    where: { customerId: req.user!.id },
    include: { items: { select: { productId: true, quantity: true, variant: { select: { price: true } } } } },
  });
  const lines = (cart?.items ?? []).map(i => ({
    productId: i.productId,
    price: Number(i.variant.price),
    quantity: i.quantity,
  }));
  const subtotal = lines.reduce((sum, l) => sum + l.price * l.quantity, 0);

  const validation = await validateShopifyDiscount(String(code).trim(), subtotal);
  if (!validation.ok) {
    res.status(validation.status).json({ message: validation.message });
    return;
  }
  const d = validation.discount;

  let discountAmount: number;
  try {
    discountAmount = await computeDiscountAmount(d, lines);
  } catch (err: unknown) {
    const status = (err as { statusCode?: number })?.statusCode ?? 400;
    res.status(status).json({ message: err instanceof Error ? err.message : 'Invalid discount code' });
    return;
  }

  res.json({
    code: d.code,
    discountType: d.discountType,
    discountValue: d.discountValue,
    minOrderValue: d.minOrderValue,
    discountAmount: discountAmount.toFixed(2),
  });
});

// Creates a PayPal order server-side (secret never leaves the server) and returns the
// approval URL for the app to open in a webview. The order is captured later in /create-order.
router.post('/create-paypal-order', requireAuth, async (req: Request, res: Response) => {
  const { shippingRateId, couponCode } = req.body;
  if (!shippingRateId) {
    res.status(400).json({ message: 'shippingRateId is required' });
    return;
  }

  let totals: Totals;
  try {
    const result = await computeTotals(req.user!.id, parseInt(shippingRateId), couponCode);
    totals = result.totals;
  } catch (err: unknown) {
    const status = (err as { statusCode?: number })?.statusCode ?? 400;
    res.status(status).json({ message: err instanceof Error ? err.message : 'Calculation failed' });
    return;
  }

  try {
    const order = await createPayPalOrder(
      totals.total.toFixed(2),
      'USD',
      `${env.APP_PUBLIC_URL}/paypal/success`,
      `${env.APP_PUBLIC_URL}/paypal/cancel`
    );
    res.json({ paypalOrderId: order.id, approveUrl: order.approveUrl });
  } catch (err) {
    res.status(502).json({ message: 'Could not start PayPal payment', error: String(err) });
  }
});

router.post('/create-order', requireAuth, async (req: Request, res: Response) => {
  const { addressId, shippingRateId, couponCode, paypalOrderId } = req.body;
  if (!addressId || !shippingRateId || !paypalOrderId) {
    res.status(400).json({ message: 'addressId, shippingRateId, and paypalOrderId are required' });
    return;
  }

  // Idempotency: if this PayPal order was already captured and recorded (e.g. the
  // client retried after a network drop), return the existing order instead of
  // attempting a second capture — a retry must never double-charge or dead-end.
  const existingPayment = await prisma.payment.findUnique({
    where: { paypalOrderId: String(paypalOrderId) },
    include: { order: true },
  });
  if (existingPayment) {
    if (existingPayment.order.customerId !== req.user!.id) {
      res.status(409).json({ message: 'Payment already used' });
      return;
    }
    res.json({
      success: true,
      order: {
        id: existingPayment.order.id,
        orderNumber: existingPayment.order.orderNumber,
        totalPrice: existingPayment.order.totalPrice,
        financialStatus: existingPayment.order.financialStatus,
      },
    });
    return;
  }

  const customer = await prisma.customer.findUnique({
    where: { id: req.user!.id },
    include: { deviceTokens: true },
  });
  if (!customer) {
    res.status(404).json({ message: 'Customer not found' });
    return;
  }

  const address = await prisma.address.findFirst({ where: { id: parseInt(addressId), customerId: customer.id } });
  if (!address) {
    res.status(404).json({ message: 'Address not found' });
    return;
  }

  let totals: Totals, discount: ValidatedDiscount | null;
  try {
    const result = await computeTotals(customer.id, parseInt(shippingRateId), couponCode);
    totals = result.totals;
    discount = result.discount;
  } catch (err: unknown) {
    const status = (err as { statusCode?: number })?.statusCode ?? 400;
    res.status(status).json({ message: err instanceof Error ? err.message : 'Checkout calculation failed' });
    return;
  }

  // Check stock
  const fullCart = await prisma.cart.findUnique({
    where: { customerId: customer.id },
    include: { items: { include: { variant: true, product: { select: { title: true } } } } },
  });
  const outOfStock = fullCart?.items.find(item => !item.variant.availableForSale);
  if (outOfStock) {
    res.status(409).json({ message: `Item "${outOfStock.variantId}" is out of stock` });
    return;
  }

  // Capture PayPal
  let paypalResult;
  try {
    paypalResult = await capturePayPalPayment(paypalOrderId);
  } catch (err) {
    res.status(402).json({ message: 'PayPal capture failed', error: String(err) });
    return;
  }

  if (paypalResult.status !== 'COMPLETED') {
    res.status(402).json({ message: `Payment not completed: ${paypalResult.status}` });
    return;
  }

  const capturedAmount = parseFloat(paypalResult.amount);
  const expectedTotal = parseFloat(totals.total.toFixed(2));
  if (Math.abs(capturedAmount - expectedTotal) > 0.01) {
    res.status(402).json({ message: 'Payment amount mismatch' });
    return;
  }

  // Build line items for storage
  const lineItemsData = fullCart!.items.map(item => ({
    variantId: item.variantId,
    productId: item.productId,
    productTitle: item.product.title,
    variantTitle: item.variant.title,
    quantity: item.quantity,
    price: Number(item.variant.price).toFixed(2),
    ...(item.properties ? { properties: item.properties } : {}),
  }));

  const shippingAddressJson = {
    address1: address.address1,
    address2: address.address2,
    city: address.city,
    province: address.province,
    country: address.country,
    zip: address.zip,
    firstName: address.firstName,
    lastName: address.lastName,
    phone: address.phone,
  };

  // Persist the order + payment IMMEDIATELY after capture, before any Shopify
  // call — the money has moved, so the record must survive whatever fails next.
  // Timestamp-based fallback number: unique under concurrency (the old
  // count-based `APP-${1001 + count}` could collide); it is replaced by the
  // real Shopify order number below whenever Shopify order creation succeeds.
  let orderNumber = `APP-${Date.now()}`;

  let order;
  try {
    order = await prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          orderNumber,
          customerId: customer.id,
          customerEmail: customer.email,
          lineItems: lineItemsData,
          subtotalPrice: totals.subtotal,
          totalShipping: totals.shipping,
          totalDiscount: totals.discount,
          totalTax: totals.tax,
          totalPrice: totals.total,
          currencyCode: 'USD',
          financialStatus: 'paid',
          fulfillmentStatus: 'unfulfilled',
          shippingAddress: shippingAddressJson,
          couponCode: couponCode ?? null,
        },
      });
      await tx.payment.create({
        data: {
          orderId: created.id,
          paymentMethod: 'paypal',
          paymentId: paypalResult.transactionId,
          paypalOrderId: String(paypalOrderId),
          status: 'completed',
          amount: totals.total,
          currency: 'USD',
          rawResponse: paypalResult.raw as never,
        },
      });
      await tx.cartItem.deleteMany({ where: { cartId: fullCart!.id! } });
      return created;
    });
  } catch (err) {
    // Captured but not recorded — the one remaining bad window. Log everything
    // needed to reconcile manually; the client must NOT retry capture.
    console.error(
      `CRITICAL: PayPal captured but order persistence failed. paypalOrderId=${paypalOrderId} transactionId=${paypalResult.transactionId} customer=${customer.email}`,
      err
    );
    res.status(500).json({
      message: 'Your payment was received but the order could not be finalized. Please contact support — do not pay again.',
    });
    return;
  }

  // Resolve Shopify customer ID before creating the Shopify order
  let shopifyCustomerId = customer.shopifyCustomerId;
  if (!shopifyCustomerId) {
    try {
      const shopifyGid = await createOrFindShopifyCustomer({
        email: customer.email,
        firstName: customer.firstName ?? undefined,
        lastName: customer.lastName ?? undefined,
        phone: customer.phone ?? undefined,
      });
      if (shopifyGid) {
        shopifyCustomerId = shopifyGid;
        await prisma.customer.update({ where: { id: customer.id }, data: { shopifyCustomerId: shopifyGid } });
      }
    } catch (err) {
      console.error('Shopify customer lookup failed:', err);
    }
  }

  // Create the Shopify order so we get the real order number (#1001, #1002 …);
  // on success, upgrade the locally persisted order with the real identifiers.
  let shopifyOrderResult: { id: string; name: string } | null = null;
  if (shopifyCustomerId) {
    try {
      shopifyOrderResult = await createShopifyOrder({
        lineItems: fullCart!.items.map(item => ({ variantId: item.variantId, quantity: item.quantity })),
        shopifyCustomerId,
        customerEmail: customer.email,
        shippingAddress: shippingAddressJson,
        totalPrice: totals.total.toFixed(2),
        paypalTransactionId: paypalResult.transactionId,
        discount,
        appliedDiscountAmount: totals.discount,
      });
    } catch (err) {
      console.error('Shopify order creation failed:', err);
    }
  }

  if (shopifyOrderResult?.name) {
    try {
      orderNumber = shopifyOrderResult.name.replace('#', '');
      order = await prisma.order.update({
        where: { id: order.id },
        data: {
          orderNumber,
          shopifyOrderId: shopifyOrderResult.id.split('/').pop(),
          shopifyCreatedAt: new Date(),
        },
      });
    } catch (err) {
      // Order + payment are already safe; worst case it keeps the APP- number.
      console.error('Failed to attach Shopify order details:', err);
    }
  }

  res.json({ success: true, order: { id: order.id, orderNumber: order.orderNumber, totalPrice: order.totalPrice, financialStatus: order.financialStatus } });

  const metaCtx = extractRequestContext(req);
  setImmediate(async () => {
    try {
      const tokens = customer.deviceTokens.map(dt => dt.fcmToken);
      if (tokens.length > 0) await sendOrderPush(tokens, 'confirmed', orderNumber);
    } catch (err) {
      console.error('FCM push failed:', err);
    }
    try {
      await sendPurchaseEvent({
        orderId: order.id,
        orderNumber,
        total: totals.total,
        contentIds: [...new Set(lineItemsData.map(li => li.productId))],
        numItems: lineItemsData.reduce((sum, li) => sum + li.quantity, 0),
        customer: {
          id: customer.id,
          email: customer.email,
          firstName: customer.firstName,
          lastName: customer.lastName,
          phone: customer.phone,
        },
        ctx: metaCtx,
      });
    } catch (err) {
      console.error('Meta CAPI Purchase failed:', err);
    }
  });
});

// TEST ONLY — bypasses PayPal, still syncs order to Shopify. Requires an explicit
// ENABLE_TEST_CHECKOUT=true opt-in (NODE_ENV alone is too easy to leave unset in
// prod, which would silently expose a free-order endpoint) and never runs in production.
router.post('/create-order-test', requireAuth, async (req: Request, res: Response) => {
  if (process.env.NODE_ENV === 'production' || process.env.ENABLE_TEST_CHECKOUT !== 'true') {
    res.status(404).json({ message: 'Not found' });
    return;
  }
  const { addressId, shippingRateId, couponCode } = req.body;
  if (!addressId || !shippingRateId) {
    res.status(400).json({ message: 'addressId and shippingRateId are required' });
    return;
  }

  const customer = await prisma.customer.findUnique({
    where: { id: req.user!.id },
    include: { deviceTokens: true },
  });
  if (!customer) { res.status(404).json({ message: 'Customer not found' }); return; }

  const address = await prisma.address.findFirst({ where: { id: parseInt(addressId), customerId: customer.id } });
  if (!address) { res.status(404).json({ message: 'Address not found' }); return; }

  let totals: Totals, discount: ValidatedDiscount | null;
  try {
    const result = await computeTotals(customer.id, parseInt(shippingRateId), couponCode);
    totals = result.totals;
    discount = result.discount;
  } catch (err: unknown) {
    const status = (err as { statusCode?: number })?.statusCode ?? 400;
    res.status(status).json({ message: err instanceof Error ? err.message : 'Checkout calculation failed' });
    return;
  }

  const fullCart = await prisma.cart.findUnique({
    where: { customerId: customer.id },
    include: { items: { include: { variant: true, product: { select: { title: true } } } } },
  });
  const outOfStock = fullCart?.items.find(item => !item.variant.availableForSale);
  if (outOfStock) {
    res.status(409).json({ message: `Item "${outOfStock.variantId}" is out of stock` });
    return;
  }

  const lineItemsData = fullCart!.items.map(item => ({
    variantId: item.variantId,
    productId: item.productId,
    productTitle: item.product.title,
    variantTitle: item.variant.title,
    quantity: item.quantity,
    price: Number(item.variant.price).toFixed(2),
    ...(item.properties ? { properties: item.properties } : {}),
  }));

  const shippingAddressJson = {
    address1: address.address1,
    address2: address.address2,
    city: address.city,
    province: address.province,
    country: address.country,
    zip: address.zip,
    firstName: address.firstName,
    lastName: address.lastName,
    phone: address.phone,
  };

  // Resolve Shopify customer ID before creating the Shopify order
  let shopifyCustomerIdTest = customer.shopifyCustomerId;
  if (!shopifyCustomerIdTest) {
    try {
      const shopifyGid = await createOrFindShopifyCustomer({
        email: customer.email,
        firstName: customer.firstName ?? undefined,
        lastName: customer.lastName ?? undefined,
        phone: customer.phone ?? undefined,
      });
      if (shopifyGid) {
        shopifyCustomerIdTest = shopifyGid;
        await prisma.customer.update({ where: { id: customer.id }, data: { shopifyCustomerId: shopifyGid } });
      }
    } catch (err) {
      console.error('[TEST] Shopify customer lookup failed:', err);
    }
  }

  // Create Shopify order synchronously to get the real order number
  let shopifyOrderResultTest: { id: string; name: string } | null = null;
  if (shopifyCustomerIdTest) {
    try {
      shopifyOrderResultTest = await createShopifyOrder({
        lineItems: fullCart!.items.map(item => ({ variantId: item.variantId, quantity: item.quantity })),
        shopifyCustomerId: shopifyCustomerIdTest,
        customerEmail: customer.email,
        shippingAddress: shippingAddressJson,
        totalPrice: totals.total.toFixed(2),
        paypalTransactionId: `TEST-${Date.now()}`,
        discount,
        appliedDiscountAmount: totals.discount,
      });
      if (shopifyOrderResultTest) {
        console.log(`[TEST] Shopify order created: ${shopifyOrderResultTest.id}`);
      }
    } catch (err) {
      console.error('[TEST] Shopify order creation failed:', err);
    }
  }

  let orderNumber: string;
  if (shopifyOrderResultTest?.name) {
    orderNumber = shopifyOrderResultTest.name.replace('#', '');
  } else {
    // Timestamp-based: unique under concurrency, unlike the old count-based scheme.
    orderNumber = `APP-${Date.now()}`;
  }

  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        orderNumber,
        customerId: customer.id,
        customerEmail: customer.email,
        lineItems: lineItemsData,
        subtotalPrice: totals.subtotal,
        totalShipping: totals.shipping,
        totalDiscount: totals.discount,
        totalTax: totals.tax,
        totalPrice: totals.total,
        currencyCode: 'USD',
        financialStatus: 'pending',
        fulfillmentStatus: 'unfulfilled',
        shippingAddress: shippingAddressJson,
        couponCode: couponCode ?? null,
        ...(shopifyOrderResultTest && {
          shopifyOrderId: shopifyOrderResultTest.id.split('/').pop(),
          shopifyCreatedAt: new Date(),
        }),
      },
    });
    await tx.payment.create({
      data: {
        orderId: created.id,
        paymentMethod: 'test',
        paymentId: `TEST-${Date.now()}`,
        status: 'pending',
        amount: totals.total,
        currency: 'USD',
        rawResponse: {} as never,
      },
    });
    await tx.cartItem.deleteMany({ where: { cartId: fullCart!.id! } });
    return created;
  });

  res.json({ success: true, order: { id: order.id, orderNumber: order.orderNumber, totalPrice: order.totalPrice, financialStatus: order.financialStatus } });
});

export default router;
