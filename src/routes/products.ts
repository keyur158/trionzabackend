import { Router, Request, Response } from 'express';
import NodeCache from 'node-cache';
import { prisma } from '../config/database';
import { Prisma } from '../generated/prisma/client';

const router = Router();
const cache = new NodeCache({ stdTTL: 300 }); // 5-minute cache

// Fields needed for product cards — no variants (fetched only on detail page)
const PRODUCT_LIST_SELECT = {
  id: true,
  title: true,
  handle: true,
  vendor: true,
  productType: true,
  tags: true,
  availableForSale: true,
  minPrice: true,
  maxPrice: true,
  compareAtPrice: true,
  currencyCode: true,
  images: true,
  createdAt: true,
};

router.get('/search', async (req: Request, res: Response) => {
  const q = (req.query.q as string)?.trim();
  if (!q) {
    res.json({ products: [] });
    return;
  }
  const products = await prisma.$queryRaw<unknown[]>`
    SELECT id, title, handle, "minPrice", images, "availableForSale"
    FROM "Product"
    WHERE to_tsvector('english', title || ' ' || COALESCE(description, ''))
          @@ plainto_tsquery('english', ${q})
    LIMIT 20
  `;
  res.json({ products });
});

// Tag-based category filters, mirroring the app's badge logic: a product
// tagged both lab-grown and moissanite counts as lab-grown.
const LAB_GROWN_COND = Prisma.sql`EXISTS (
  SELECT 1 FROM unnest(tags) tag
  WHERE tag ILIKE '%lab grown%' OR tag ILIKE '%lab-grown%'
)`;
const MOISSANITE_COND = Prisma.sql`EXISTS (
  SELECT 1 FROM unnest(tags) tag WHERE tag ILIKE '%moissanite%'
) AND NOT ${LAB_GROWN_COND}`;

async function listByCategory(category: string, page: number, limit: number, sort?: string) {
  const cond = category === 'lab-grown' ? LAB_GROWN_COND : MOISSANITE_COND;
  let orderBy = Prisma.sql`"createdAt" DESC`;
  if (sort === 'price_asc') orderBy = Prisma.sql`"minPrice" ASC NULLS LAST`;
  else if (sort === 'price_desc') orderBy = Prisma.sql`"minPrice" DESC NULLS LAST`;
  else if (sort === 'newest') orderBy = Prisma.sql`"shopifyCreatedAt" DESC NULLS LAST`;
  else if (sort === 'title') orderBy = Prisma.sql`title ASC`;

  const [products, countRows] = await Promise.all([
    prisma.$queryRaw<unknown[]>`
      SELECT id, title, handle, vendor, "productType", tags, "availableForSale",
             "minPrice", "maxPrice", "compareAtPrice", "currencyCode", images, "createdAt"
      FROM "Product"
      WHERE "availableForSale" = true AND ${cond}
      ORDER BY ${orderBy}
      LIMIT ${limit} OFFSET ${(page - 1) * limit}
    `,
    prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count FROM "Product"
      WHERE "availableForSale" = true AND ${cond}
    `,
  ]);
  return { products, total: countRows[0]?.count ?? 0 };
}

router.get('/', async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const sort = req.query.sort as string;
  const type = req.query.type as string;
  const category = req.query.category as string;

  const cacheKey = `products:${page}:${limit}:${sort || ''}:${type || ''}:${category || ''}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  if (category === 'lab-grown' || category === 'moissanite') {
    const { products, total } = await listByCategory(category, page, limit, sort);
    const result = { products, total, page, limit, pages: Math.ceil(total / limit) };
    cache.set(cacheKey, result);
    res.json(result);
    return;
  }

  const where = {
    availableForSale: true,
    ...(type ? { productType: type } : {}),
  };

  let orderBy: Record<string, string> = { createdAt: 'desc' };
  if (sort === 'price_asc') orderBy = { minPrice: 'asc' };
  else if (sort === 'price_desc') orderBy = { minPrice: 'desc' };
  else if (sort === 'title') orderBy = { title: 'asc' };

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
      select: PRODUCT_LIST_SELECT,
    }),
    prisma.product.count({ where }),
  ]);

  const result = { products, total, page, limit, pages: Math.ceil(total / limit) };
  cache.set(cacheKey, result);
  res.json(result);
});

router.get('/:handle', async (req: Request, res: Response) => {
  const product = await prisma.product.findUnique({
    where: { handle: req.params.handle as string },
    include: {
      variants: true,
      collections: { select: { collection: { select: { title: true, handle: true } } } },
    },
  });
  if (!product) {
    res.status(404).json({ message: 'Product not found' });
    return;
  }
  const { collections, ...rest } = product;
  res.json({
    product: {
      ...rest,
      collections: collections.map((c) => ({
        title: c.collection.title,
        handle: c.collection.handle,
      })),
    },
  });
});

export default router;
