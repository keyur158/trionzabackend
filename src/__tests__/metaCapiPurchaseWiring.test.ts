jest.mock('../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: 'cust-1', email: 'a@a.com' };
    next();
  },
}));
jest.mock('../services/shopify-discount', () => ({ validateShopifyDiscount: jest.fn() }));
jest.mock('../services/paypal', () => ({
  createPayPalOrder: jest.fn(),
  capturePayPalPayment: jest.fn(),
}));
jest.mock('../services/shopify-order', () => ({ createShopifyOrder: jest.fn().mockResolvedValue(null) }));
jest.mock('../services/shopify-customer', () => ({ createOrFindShopifyCustomer: jest.fn().mockResolvedValue(null) }));
jest.mock('../services/push', () => ({ sendOrderPush: jest.fn() }));
jest.mock('../services/meta-capi', () => ({
  sendPurchaseEvent: jest.fn().mockResolvedValue(true),
  extractRequestContext: jest.fn().mockReturnValue({ platform: 'android', attEnabled: false }),
}));
jest.mock('../config/database', () => ({
  prisma: {
    cart: { findUnique: jest.fn() },
    shippingRate: { findUnique: jest.fn() },
    payment: { findUnique: jest.fn() },
    customer: { findUnique: jest.fn(), update: jest.fn() },
    address: { findFirst: jest.fn() },
    order: { update: jest.fn() },
    $transaction: jest.fn(),
  },
}));

import express from 'express';
import request from 'supertest';
import router from '../routes/checkout';
import { prisma } from '../config/database';
import { capturePayPalPayment } from '../services/paypal';
import { sendPurchaseEvent } from '../services/meta-capi';

const app = express();
app.use(express.json());
app.use('/api/checkout', router);

const cart = {
  id: 1,
  items: [{
    productId: 'p1', variantId: 'v1', quantity: 2, properties: null,
    variant: { id: 'v1', title: 'V', price: 100, availableForSale: true, inventoryQty: 5 },
    product: { title: 'Ring' },
  }],
};

describe('POST /api/checkout/create-order fires Meta Purchase', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.payment.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.customer.findUnique as jest.Mock).mockResolvedValue({
      id: 'cust-1', email: 'a@a.com', firstName: 'A', lastName: 'B', phone: '555',
      shopifyCustomerId: 'gid://1', deviceTokens: [],
    });
    (prisma.address.findFirst as jest.Mock).mockResolvedValue({
      id: 1, address1: 'x', address2: null, city: 'c', province: 'p', country: 'US', zip: 'z',
      firstName: 'A', lastName: 'B', phone: '555',
    });
    // computeTotals + stock check both re-read the cart (items include variant+product).
    (prisma.cart.findUnique as jest.Mock).mockResolvedValue(cart);
    (prisma.shippingRate.findUnique as jest.Mock).mockResolvedValue({ id: 1, price: 20, isActive: true, minOrderValue: null });
    (capturePayPalPayment as jest.Mock).mockResolvedValue({ status: 'COMPLETED', transactionId: 'T1', amount: '220.00', raw: {} });
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn: any) => fn({
      order: { create: jest.fn().mockResolvedValue({ id: 42, orderNumber: 'APP-1', totalPrice: 220, financialStatus: 'paid' }) },
      payment: { create: jest.fn().mockResolvedValue({}) },
      cartItem: { deleteMany: jest.fn().mockResolvedValue({}) },
    }));
  });

  it('sends Purchase with order totals after a successful order', async () => {
    const res = await request(app)
      .post('/api/checkout/create-order')
      .send({ addressId: 1, shippingRateId: 1, paypalOrderId: 'PP-1' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // The CAPI call runs in setImmediate after the response — flush it.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(sendPurchaseEvent).toHaveBeenCalledTimes(1);
    const call = (sendPurchaseEvent as jest.Mock).mock.calls[0][0];
    expect(call.orderId).toBe(42);
    expect(call.total).toBe(220);
    expect(call.contentIds).toEqual(['p1']);
    expect(call.numItems).toBe(2);
    expect(call.customer).toMatchObject({ id: 'cust-1', email: 'a@a.com' });
  });
});
