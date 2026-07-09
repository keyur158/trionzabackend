jest.mock('../config/database', () => ({
  prisma: { filterOption: { findMany: jest.fn() } },
}));

import express from 'express';
import request from 'supertest';
import router from '../routes/filter-options';
import { prisma } from '../config/database';

const app = express();
app.use('/api/filter-options', router);

describe('GET /api/filter-options', () => {
  beforeEach(() => jest.clearAllMocks());

  it('groups options by type in position order', async () => {
    (prisma.filterOption.findMany as jest.Mock).mockResolvedValue([
      { id: 1, type: 'clarity', handle: 'fl', label: 'FL', position: 0 },
      { id: 2, type: 'clarity', handle: 'if', label: 'IF', position: 1 },
      { id: 3, type: 'shape', handle: 'round', label: 'Round', position: 0 },
    ]);

    const res = await request(app).get('/api/filter-options');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      options: {
        clarity: [{ handle: 'fl', label: 'FL' }, { handle: 'if', label: 'IF' }],
        shape: [{ handle: 'round', label: 'Round' }],
      },
    });
    expect(prisma.filterOption.findMany).toHaveBeenCalledWith({
      orderBy: [{ type: 'asc' }, { position: 'asc' }],
    });
  });
});
