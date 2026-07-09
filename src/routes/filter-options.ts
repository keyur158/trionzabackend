import { Router, Request, Response } from 'express';
import NodeCache from 'node-cache';
import { prisma } from '../config/database';

const router = Router();
const cache = new NodeCache({ stdTTL: 300 });

router.get('/', async (_req: Request, res: Response) => {
  const cached = cache.get('filter-options');
  if (cached) {
    res.json(cached);
    return;
  }
  const rows = await prisma.filterOption.findMany({
    orderBy: [{ type: 'asc' }, { position: 'asc' }],
  });
  const options: Record<string, Array<{ handle: string; label: string }>> = {};
  for (const r of rows) {
    (options[r.type] ??= []).push({ handle: r.handle, label: r.label });
  }
  const result = { options };
  cache.set('filter-options', result);
  res.json(result);
});

export default router;
