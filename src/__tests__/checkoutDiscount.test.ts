jest.mock('../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: 'cust-1', email: 'a@a.com' };
    next();
  },
}));
jest.mock('../services/shopify-discount', () => ({
  validateShopifyDiscount: jest.fn(),
}));
jest.mock('../services/paypal', () => ({
  createPayPalOrder: jest.fn(),
  capturePayPalPayment: jest.fn(),
}));
jest.mock('../services/shopify-order', () => ({
  createShopifyOrder: jest.fn(),
  updateOrderFromWebhook: jest.fn(),
}));
jest.mock('../services/shopify-customer', () => ({
  createOrFindShopifyCustomer: jest.fn(),
}));
jest.mock('../services/push', () => ({ sendOrderPush: jest.fn() }));
jest.mock('../config/database', () => ({
  prisma: {
    cart: { findUnique: jest.fn() },
    shippingRate: { findUnique: jest.fn() },
  },
}));

import express from 'express';
import request from 'supertest';
import router from '../routes/checkout';
import { prisma } from '../config/database';
import { validateShopifyDiscount } from '../services/shopify-discount';

const app = express();
app.use(express.json());
app.use('/api/checkout', router);

const mockValidate = validateShopifyDiscount as jest.Mock;

function cartWith(price: number, qty = 1) {
  return {
    id: 1,
    items: [{
      quantity: qty,
      variant: { id: 'v1', title: 'V', price, availableForSale: true, inventoryQty: 5 },
      product: { title: 'P', images: [] },
    }],
  };
}

describe('POST /api/checkout/calculate with Shopify discounts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.cart.findUnique as jest.Mock).mockResolvedValue(cartWith(500));
    (prisma.shippingRate.findUnique as jest.Mock).mockResolvedValue({
      id: 1, price: 20, isActive: true, minOrderValue: null,
    });
  });

  it('applies a percentage discount to the subtotal', async () => {
    mockValidate.mockResolvedValue({
      ok: true,
      discount: { code: 'SAVE10', discountType: 'percentage', discountValue: 10, minOrderValue: null },
    });

    const res = await request(app)
      .post('/api/checkout/calculate')
      .send({ shippingRateId: 1, couponCode: 'SAVE10' });

    expect(res.status).toBe(200);
    expect(res.body.discount).toBe('50.00');
    expect(res.body.total).toBe('470.00');
  });

  it('caps a fixed discount at the subtotal', async () => {
    mockValidate.mockResolvedValue({
      ok: true,
      discount: { code: 'FLAT900', discountType: 'fixed', discountValue: 900, minOrderValue: null },
    });

    const res = await request(app)
      .post('/api/checkout/calculate')
      .send({ shippingRateId: 1, couponCode: 'FLAT900' });

    expect(res.body.discount).toBe('500.00');
    expect(res.body.total).toBe('20.00');
  });

  it('propagates validation failures with the service status and message', async () => {
    mockValidate.mockResolvedValue({ ok: false, status: 400, message: 'This code has expired' });

    const res = await request(app)
      .post('/api/checkout/calculate')
      .send({ shippingRateId: 1, couponCode: 'OLD' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('This code has expired');
  });

  it('propagates 503 when Shopify is unreachable (fail closed)', async () => {
    mockValidate.mockResolvedValue({
      ok: false, status: 503, message: "Couldn't verify the code right now. Please try again.",
    });

    const res = await request(app)
      .post('/api/checkout/calculate')
      .send({ shippingRateId: 1, couponCode: 'ANY' });

    expect(res.status).toBe(503);
  });

  it('computes without discount when no code is given (and never calls Shopify)', async () => {
    const res = await request(app)
      .post('/api/checkout/calculate')
      .send({ shippingRateId: 1 });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe('520.00');
    expect(mockValidate).not.toHaveBeenCalled();
  });
});

describe('POST /api/checkout/validate-coupon', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.cart.findUnique as jest.Mock).mockResolvedValue(cartWith(500));
  });

  it('returns the discount details on success', async () => {
    mockValidate.mockResolvedValue({
      ok: true,
      discount: { code: 'SAVE10', discountType: 'percentage', discountValue: 10, minOrderValue: null },
    });

    const res = await request(app)
      .post('/api/checkout/validate-coupon')
      .send({ code: 'SAVE10' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      code: 'SAVE10', discountType: 'percentage', discountValue: 10, minOrderValue: null,
    });
    expect(mockValidate).toHaveBeenCalledWith('SAVE10', 500);
  });

  it('surfaces rejection status and message', async () => {
    mockValidate.mockResolvedValue({ ok: false, status: 404, message: 'Invalid discount code' });
    const res = await request(app)
      .post('/api/checkout/validate-coupon')
      .send({ code: 'NOPE' });
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Invalid discount code');
  });
});
