import { Router, Request, Response } from 'express';
import { prisma } from '../config/database';
import { compareVersions } from '../utils/version';

const router = Router();

type Row = {
  platform: string;
  version: string;
  forced: boolean;
  message: string;
  storeUrl: string;
};

function block(rows: Row[]) {
  const sorted = [...rows].sort((a, b) => compareVersions(a.version, b.version));
  const newest = sorted[sorted.length - 1];
  return {
    store_url: newest?.storeUrl ?? '',
    releases: sorted.map((r) => ({ version: r.version, forced: r.forced, message: r.message })),
  };
}

// GET /api/app/version  (public)
router.get('/version', async (_req: Request, res: Response) => {
  const rows = (await prisma.appVersion.findMany()) as Row[];
  res.json({
    android: block(rows.filter((r) => r.platform === 'android')),
    ios: block(rows.filter((r) => r.platform === 'ios')),
  });
});

export default router;