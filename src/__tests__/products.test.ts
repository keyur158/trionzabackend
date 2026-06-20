jest.mock('../config/database', () => ({
  prisma: { product: { findUnique: jest.fn() } },
}));

import express from 'express';
import request from 'supertest';
import productsRouter from '../routes/products';
import { prisma } from '../config/database';

const mockFindUnique = prisma.product.findUnique as jest.Mock;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/products', productsRouter);
  return app;
}

const app = buildApp();

describe('GET /api/products/:handle', () => {
  beforeEach(() => jest.clearAllMocks());

  it('flattens collections to [{title, handle}]', async () => {
    mockFindUnique.mockResolvedValue({
      id: '1',
      title: 'Ring',
      handle: 'ring',
      variants: [],
      collections: [
        { collection: { title: 'Engagement Rings', handle: 'engagement-rings' } },
        { collection: { title: 'Bridal Sets', handle: 'bridal-sets' } },
      ],
    });
    const res = await request(app).get('/api/products/ring');
    expect(res.status).toBe(200);
    expect(res.body.product.collections).toEqual([
      { title: 'Engagement Rings', handle: 'engagement-rings' },
      { title: 'Bridal Sets', handle: 'bridal-sets' },
    ]);
  });

  it('returns an empty collections array when the product has none', async () => {
    mockFindUnique.mockResolvedValue({
      id: '2', title: 'Pendant', handle: 'pendant', variants: [], collections: [],
    });
    const res = await request(app).get('/api/products/pendant');
    expect(res.status).toBe(200);
    expect(res.body.product.collections).toEqual([]);
  });

  it('returns 404 when product is missing', async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await request(app).get('/api/products/nope');
    expect(res.status).toBe(404);
  });
});
