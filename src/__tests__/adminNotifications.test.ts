jest.mock('../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: 'x', email: 'admin@trionza.com' };
    next();
  },
}));
jest.mock('../utils/admin', () => ({ isAdminEmail: () => true }));
jest.mock('../config/database', () => ({
  prisma: { deviceToken: { findMany: jest.fn() } },
}));
jest.mock('../services/push', () => ({
  sendPushToTokens: jest.fn(),
}));

import express from 'express';
import request from 'supertest';
import router from '../routes/adminNotifications';
import { prisma } from '../config/database';
import { sendPushToTokens } from '../services/push';

const mockTokens = prisma.deviceToken.findMany as jest.Mock;
const mockSend = sendPushToTokens as jest.Mock;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/notifications', router);
  return app;
}
const app = buildApp();

describe('POST /api/admin/notifications/send', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sends to all device tokens', async () => {
    mockTokens.mockResolvedValue([{ fcmToken: 'a' }, { fcmToken: 'b' }]);
    mockSend.mockResolvedValue({ successCount: 2, failureCount: 0 });
    const res = await request(app)
      .post('/api/admin/notifications/send')
      .send({ title: 'Hi', body: 'Sale' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sent: 2, failed: 0, recipients: 2 });
    expect(mockSend).toHaveBeenCalledWith(['a', 'b'], 'Hi', 'Sale', expect.any(Object));
  });

  it('rejects missing title/body', async () => {
    const res = await request(app).post('/api/admin/notifications/send').send({ title: 'Hi' });
    expect(res.status).toBe(400);
  });
});