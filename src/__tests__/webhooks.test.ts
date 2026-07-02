jest.mock('../config/database', () => ({
  prisma: {
    webhookEvent: {
      create: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
    order: {
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    },
  },
}));
jest.mock('../services/product-sync', () => ({
  upsertProduct: jest.fn().mockResolvedValue(undefined),
  deleteProduct: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/shopify-order', () => ({
  updateOrderFromWebhook: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/push', () => ({
  sendOrderPush: jest.fn().mockResolvedValue(undefined),
}));

import express from 'express';
import request from 'supertest';
import crypto from 'crypto';
import webhookRoutes from '../routes/webhooks';
import { prisma } from '../config/database';
import { upsertProduct } from '../services/product-sync';
import { sendOrderPush } from '../services/push';
import { env } from '../config/env';

const mockCreate = prisma.webhookEvent.create as jest.Mock;
const mockDelete = prisma.webhookEvent.delete as jest.Mock;
const mockUpsertProduct = upsertProduct as jest.Mock;
const mockSendPush = sendOrderPush as jest.Mock;
const mockOrderFindFirst = prisma.order.findFirst as jest.Mock;
const mockOrderUpdate = prisma.order.update as jest.Mock;

function buildApp() {
  const app = express();
  app.use('/webhooks', express.raw({ type: 'application/json' }));
  app.use('/webhooks', webhookRoutes);
  return app;
}

const app = buildApp();

function sign(body: string): string {
  return crypto.createHmac('sha256', env.SHOPIFY_WEBHOOK_SECRET).update(body).digest('base64');
}

// Processing happens after the 200 is sent — drain the microtask queue.
async function flushAsync(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise(setImmediate);
}

const body = JSON.stringify({ id: 123, title: 'Ring', handle: 'ring', tags: '', variants: [], images: [] });

function post(hmac: string) {
  return request(app)
    .post('/webhooks')
    .set('Content-Type', 'application/json')
    .set('x-shopify-topic', 'products/update')
    .set('x-shopify-webhook-id', 'evt-1')
    .set('x-shopify-hmac-sha256', hmac)
    .send(body);
}

describe('POST /webhooks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate.mockResolvedValue({});
    mockDelete.mockResolvedValue({});
    mockUpsertProduct.mockResolvedValue(undefined);
  });

  it('rejects a missing HMAC header with 401', async () => {
    const res = await request(app)
      .post('/webhooks')
      .set('Content-Type', 'application/json')
      .set('x-shopify-topic', 'products/update')
      .set('x-shopify-webhook-id', 'evt-1')
      .send(body);
    expect(res.status).toBe(401);
  });

  it('rejects a malformed (wrong-length) HMAC header with 401, not 500', async () => {
    const res = await post('tooshort');
    expect(res.status).toBe(401);
  });

  it('rejects a wrong same-length HMAC with 401', async () => {
    const good = sign(body);
    const bad = (good[0] === 'A' ? 'B' : 'A') + good.slice(1);
    const res = await post(bad);
    expect(res.status).toBe(401);
  });

  it('processes a valid webhook and keeps the dedup row', async () => {
    const res = await post(sign(body));
    expect(res.status).toBe(200);
    await flushAsync();
    expect(mockCreate).toHaveBeenCalledWith({ data: { eventId: 'evt-1', topic: 'products/update' } });
    expect(mockUpsertProduct).toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('removes the dedup row when processing fails so retries are not lost', async () => {
    mockUpsertProduct.mockRejectedValue(new Error('db down'));
    const res = await post(sign(body));
    expect(res.status).toBe(200);
    await flushAsync();
    expect(mockCreate).toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledWith({ where: { eventId: 'evt-1' } });
  });

  it('skips processing for duplicate events', async () => {
    mockCreate.mockRejectedValue(new Error('unique constraint'));
    const res = await post(sign(body));
    expect(res.status).toBe(200);
    await flushAsync();
    expect(mockUpsertProduct).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });
});