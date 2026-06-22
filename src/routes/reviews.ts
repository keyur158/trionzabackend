import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import {
  getProductReviews,
  createReview,
  getReviewEligibility,
  updateOwnReview,
  deleteOwnReview,
  ReviewError,
} from '../services/reviews';

const router = Router();

const createSchema = z.object({
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().max(120).optional(),
  body: z.string().trim().min(1, 'Review text is required').max(4000),
});

// GET /api/products/:handle/reviews
router.get('/:handle/reviews', async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 10));
  try {
    const data = await getProductReviews(req.params.handle as string, page, limit);
    res.json(data);
  } catch (err) {
    if (err instanceof ReviewError && err.code === 'NOT_FOUND') {
      res.status(404).json({ message: err.message });
      return;
    }
    throw err;
  }
});

// GET /api/products/:handle/reviews/eligibility
router.get('/:handle/reviews/eligibility', requireAuth, async (req: Request, res: Response) => {
  try {
    const data = await getReviewEligibility(req.params.handle as string, req.user!.id);
    res.json(data);
  } catch (err) {
    if (err instanceof ReviewError && err.code === 'NOT_FOUND') {
      res.status(404).json({ message: err.message });
      return;
    }
    throw err;
  }
});

// POST /api/products/:handle/reviews
router.post('/:handle/reviews', requireAuth, async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0]?.message ?? 'Invalid request' });
    return;
  }
  try {
    const review = await createReview(req.params.handle as string, req.user!.id, parsed.data);
    res.status(201).json({ review });
  } catch (err) {
    if (err instanceof ReviewError) {
      res.status(err.code === 'DUPLICATE' ? 409 : 404).json({ message: err.message });
      return;
    }
    throw err;
  }
});

// PUT /api/products/:handle/reviews/mine
router.put('/:handle/reviews/mine', requireAuth, async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0]?.message ?? 'Invalid request' });
    return;
  }
  try {
    const review = await updateOwnReview(req.params.handle as string, req.user!.id, parsed.data);
    res.json({ review });
  } catch (err) {
    if (err instanceof ReviewError) {
      res.status(err.code === 'DUPLICATE' ? 409 : 404).json({ message: err.message });
      return;
    }
    throw err;
  }
});

// DELETE /api/products/:handle/reviews/mine
router.delete('/:handle/reviews/mine', requireAuth, async (req: Request, res: Response) => {
  try {
    await deleteOwnReview(req.params.handle as string, req.user!.id);
    res.json({ success: true });
  } catch (err) {
    if (err instanceof ReviewError) {
      res.status(err.code === 'DUPLICATE' ? 409 : 404).json({ message: err.message });
      return;
    }
    throw err;
  }
});

export default router;
