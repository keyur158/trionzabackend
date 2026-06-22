import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/requireAdmin';
import {
  listAllReviews,
  setReviewStatus,
  adminDeleteReview,
  ReviewError,
} from '../services/reviews';

const router = Router();
router.use(requireAuth, requireAdmin);

// GET /api/admin/reviews
router.get('/', async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
  const data = await listAllReviews(page, limit);
  res.json(data);
});

// PATCH /api/admin/reviews/:id
router.patch('/:id', async (req: Request, res: Response) => {
  const status = (req.body ?? {}).status;
  if (status !== 'published' && status !== 'hidden') {
    res.status(400).json({ message: 'status must be "published" or "hidden"' });
    return;
  }
  try {
    const review = await setReviewStatus(req.params.id as string, status);
    res.json({ review });
  } catch (err) {
    if (err instanceof ReviewError) {
      res.status(404).json({ message: err.message });
      return;
    }
    throw err;
  }
});

// DELETE /api/admin/reviews/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await adminDeleteReview(req.params.id as string);
    res.json({ success: true });
  } catch (err) {
    if (err instanceof ReviewError) {
      res.status(404).json({ message: err.message });
      return;
    }
    throw err;
  }
});

export default router;
