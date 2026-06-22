import { Router, Request, Response } from 'express';
import { prisma } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/requireAdmin';

const router = Router();
router.use(requireAuth, requireAdmin);

// GET /api/admin/app-versions
router.get('/', async (_req: Request, res: Response) => {
  const versions = await prisma.appVersion.findMany({
    orderBy: [{ platform: 'asc' }, { createdAt: 'desc' }],
  });
  res.json({ versions });
});

// POST /api/admin/app-versions
router.post('/', async (req: Request, res: Response) => {
  const { platform, version, forced, message, storeUrl } = req.body ?? {};
  if (platform !== 'android' && platform !== 'ios') {
    res.status(400).json({ message: 'platform must be "android" or "ios"' });
    return;
  }
  if (typeof version !== 'string' || !version.trim()) {
    res.status(400).json({ message: 'version is required' });
    return;
  }
  try {
    const created = await prisma.appVersion.create({
      data: {
        platform,
        version: version.trim(),
        forced: Boolean(forced),
        message: typeof message === 'string' ? message : '',
        storeUrl: typeof storeUrl === 'string' ? storeUrl : '',
      },
    });
    res.status(201).json({ version: created });
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === 'P2002') {
      res.status(409).json({ message: 'That platform + version already exists' });
      return;
    }
    throw err;
  }
});

// PATCH /api/admin/app-versions/:id
router.patch('/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ message: 'invalid id' });
    return;
  }
  const { forced, message, storeUrl, version } = req.body ?? {};
  const data: Record<string, unknown> = {};
  if (forced !== undefined) data.forced = Boolean(forced);
  if (typeof message === 'string') data.message = message;
  if (typeof storeUrl === 'string') data.storeUrl = storeUrl;
  if (typeof version === 'string' && version.trim()) data.version = version.trim();
  const updated = await prisma.appVersion.update({ where: { id }, data });
  res.json({ version: updated });
});

// DELETE /api/admin/app-versions/:id
router.delete('/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ message: 'invalid id' });
    return;
  }
  await prisma.appVersion.delete({ where: { id } });
  res.json({ success: true });
});

export default router;