jest.mock('../config/database', () => {
  const queryRaw = jest.fn();
  return { prisma: { $queryRaw: queryRaw, product: {}, __queryRaw: queryRaw } };
});

import express from 'express';
import request from 'supertest';
import router from '../routes/products';
import { prisma } from '../config/database';

const app = express();
app.use('/api/products', router);
const queryRaw = prisma.$queryRaw as jest.Mock;

describe('GET /api/products/facets', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns total, priceRange, growthTypes and per-key facets', async () => {
    queryRaw
      // 1: total
      .mockResolvedValueOnce([{ count: 214 }])
      // 2: price range
      .mockResolvedValueOnce([{ min: 199, max: 15999 }])
      // 3: growth type counts
      .mockResolvedValueOnce([{ labGrown: 120, moissanite: 80, natural: 14, gemstone: 0, other: 0 }])
      // 4: distinct metafield keys
      .mockResolvedValueOnce([{ key: 'shape' }, { key: 'growth_type' }])
      // 5: facet counts for 'shape' (growth_type is skipped)
      .mockResolvedValueOnce([{ value: 'Round', count: 124 }, { value: 'Oval', count: 90 }]);

    const res = await request(app).get('/api/products/facets?category=lab-grown');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(214);
    expect(res.body.priceRange).toEqual({ min: 199, max: 15999 });
    expect(res.body.growthTypes).toEqual({ 'lab-grown': 120, moissanite: 80, natural: 14 });
    expect(res.body.facets.shape).toEqual([
      { value: 'Round', count: 124 },
      { value: 'Oval', count: 90 },
    ]);
    expect(res.body.facets.growth_type).toBeUndefined();
  });
});
