jest.mock('../config/database', () => ({
  prisma: {
    appVersion: {
      findMany: jest.fn(),
    },
  },
}));

import express from 'express';
import request from 'supertest';
import appVersionRouter from '../routes/appVersion';
import { prisma } from '../config/database';

const mockFindMany = prisma.appVersion.findMany as jest.Mock;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/app', appVersionRouter);
  return app;
}
const app = buildApp();

describe('GET /api/app/version', () => {
  beforeEach(() => jest.clearAllMocks());

  it('groups releases by platform with store_url from newest row', async () => {
    mockFindMany.mockResolvedValue([
      { id: 1, platform: 'android', version: '1.2.0', forced: false, message: 'a', storeUrl: 'PLAY' },
      { id: 2, platform: 'android', version: '1.4.0', forced: true, message: 'b', storeUrl: 'PLAY2' },
      { id: 3, platform: 'ios', version: '1.4.0', forced: false, message: 'c', storeUrl: 'APPSTORE' },
    ]);
    const res = await request(app).get('/api/app/version');
    expect(res.status).toBe(200);
    expect(res.body.android.store_url).toBe('PLAY2');
    expect(res.body.android.releases).toHaveLength(2);
    expect(res.body.ios.releases[0]).toEqual({ version: '1.4.0', forced: false, message: 'c' });
  });

  it('returns empty platform blocks when no rows', async () => {
    mockFindMany.mockResolvedValue([]);
    const res = await request(app).get('/api/app/version');
    expect(res.status).toBe(200);
    expect(res.body.android.releases).toEqual([]);
    expect(res.body.ios.releases).toEqual([]);
  });
});