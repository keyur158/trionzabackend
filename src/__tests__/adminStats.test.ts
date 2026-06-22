jest.mock('../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: 'x', email: 'a@a.com' };
    next();
  },
}));
jest.mock('../utils/admin', () => ({ isAdminEmail: () => true }));
jest.mock('../config/database', () => ({
  prisma: {
    customer: { count: jest.fn() },
    order: { count: jest.fn(), aggregate: jest.fn() },
    deviceToken: { count: jest.fn() },
  },
}));

import express from 'express';
import request from 'supertest';
import router from '../routes/adminStats';
import { prisma } from '../config/database';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/stats', router);
  return app;
}
const app = buildApp();

describe('GET /api/admin/stats', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns aggregate counts', async () => {
    (prisma.customer.count as jest.Mock).mockResolvedValue(870);
    (prisma.order.count as jest.Mock).mockResolvedValueOnce(1240).mockResolvedValueOnce(12);
    (prisma.deviceToken.count as jest.Mock).mockResolvedValue(640);
    (prisma.order.aggregate as jest.Mock).mockResolvedValue({ _sum: { totalPrice: 48300 } });
    const res = await request(app).get('/api/admin/stats');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ customers: 870, orders: 1240, devices: 640, revenue: 48300, todayOrders: 12 });
  });
});
