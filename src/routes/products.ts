import { Router, Request, Response } from 'express';
import NodeCache from 'node-cache';
import { prisma } from '../config/database';
import { Prisma } from '../generated/prisma/client';
import { buildProductWhere, parseFiltersParam, categoryCondition } from '../utils/product-query';

const router = Router();
const cache = new NodeCache({ stdTTL: 300 }); // 5-minute cache
const facetsCache = new NodeCache({ stdTTL: 60 });

// Fields needed for product cards — no variants (fetched only on detail page).
// metafields power the client-side filter chips (shape/style/category/growth).
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
  metafields: true,
  avgRating: true,
  reviewCount: true,
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

function orderBySql(sort?: string): Prisma.Sql {
  if (sort === 'price_asc') return Prisma.sql`"minPrice" ASC NULLS LAST`;
  if (sort === 'price_desc') return Prisma.sql`"minPrice" DESC NULLS LAST`;
  if (sort === 'newest') return Prisma.sql`"shopifyCreatedAt" DESC NULLS LAST`;
  if (sort === 'title') return Prisma.sql`title ASC`;
  return Prisma.sql`"createdAt" DESC`;
}

async function listFiltered(
  where: Prisma.Sql,
  page: number,
  limit: number,
  sort?: string
) {
  const [products, countRows] = await Promise.all([
    prisma.$queryRaw<unknown[]>`
      SELECT id, title, handle, vendor, "productType", tags, "availableForSale",
             "minPrice", "maxPrice", "compareAtPrice", "currencyCode", images,
             metafields, "avgRating", "reviewCount", "createdAt"
      FROM "Product"
      WHERE ${where}
      ORDER BY ${orderBySql(sort)}
      LIMIT ${limit} OFFSET ${(page - 1) * limit}
    `,
    prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count FROM "Product" WHERE ${where}
    `,
  ]);
  return { products, total: countRows[0]?.count ?? 0 };
}

router.get('/', async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const sort = req.query.sort as string;
  const type = req.query.type as string;
  const category = req.query.category as string | undefined;
  const filters = parseFiltersParam(req.query.filters);
  const minPriceRaw = parseFloat(req.query.minPrice as string);
  const maxPriceRaw = parseFloat(req.query.maxPrice as string);
  const minPrice = Number.isFinite(minPriceRaw) ? minPriceRaw : undefined;
  const maxPrice = Number.isFinite(maxPriceRaw) ? maxPriceRaw : undefined;

  const cacheKey = `products:${page}:${limit}:${sort || ''}:${type || ''}:${category || ''}:${(req.query.filters as string) || ''}:${minPrice ?? ''}:${maxPrice ?? ''}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  if (category || filters || minPrice !== undefined || maxPrice !== undefined) {
    const where = buildProductWhere({ category, filters, minPrice, maxPrice, type });
    const { products, total } = await listFiltered(where, page, limit, sort);
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

const GROWTH_CATEGORIES = ['lab-grown', 'moissanite', 'natural', 'gemstone', 'other'] as const;

router.get('/facets', async (req: Request, res: Response) => {
  const category = req.query.category as string | undefined;
  const filters = parseFiltersParam(req.query.filters);
  const minPriceRaw = parseFloat(req.query.minPrice as string);
  const maxPriceRaw = parseFloat(req.query.maxPrice as string);
  const minPrice = Number.isFinite(minPriceRaw) ? minPriceRaw : undefined;
  const maxPrice = Number.isFinite(maxPriceRaw) ? maxPriceRaw : undefined;

  const cacheKey = `facets:${category || ''}:${(req.query.filters as string) || ''}:${minPrice ?? ''}:${maxPrice ?? ''}`;
  const cached = facetsCache.get(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  const base = { category, filters, minPrice, maxPrice };

  // total: everything applied
  const totalRows = await prisma.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*)::int AS count FROM "Product" WHERE ${buildProductWhere(base)}`;

  // price bounds: everything except the price selection itself
  const priceRows = await prisma.$queryRaw<Array<{ min: number | null; max: number | null }>>`
    SELECT MIN("minPrice")::float AS min, MAX("minPrice")::float AS max
    FROM "Product" WHERE ${buildProductWhere({ category, filters })}`;

  // growth type counts: everything except the category selection
  const noCategoryWhere = buildProductWhere({ filters, minPrice, maxPrice });
  const growthRows = await prisma.$queryRaw<Array<Record<string, number>>>`
    SELECT
      COUNT(*) FILTER (WHERE ${categoryCondition('lab-grown')!})::int  AS "labGrown",
      COUNT(*) FILTER (WHERE ${categoryCondition('moissanite')!})::int AS "moissanite",
      COUNT(*) FILTER (WHERE ${categoryCondition('natural')!})::int    AS "natural",
      COUNT(*) FILTER (WHERE ${categoryCondition('gemstone')!})::int   AS "gemstone",
      COUNT(*) FILTER (WHERE ${categoryCondition('other')!})::int      AS "other"
    FROM "Product" WHERE ${noCategoryWhere}`;
  const g = growthRows[0] ?? {};
  const growthKeyMap: Record<string, string> = {
    labGrown: 'lab-grown', moissanite: 'moissanite', natural: 'natural',
    gemstone: 'gemstone', other: 'other',
  };
  const growthTypes: Record<string, number> = {};
  for (const [col, key] of Object.entries(growthKeyMap)) {
    if ((g[col] ?? 0) > 0) growthTypes[key] = g[col];
  }

  // which metafield keys exist in this category scope (cap: 20 facet sections)
  const keyRows = await prisma.$queryRaw<Array<{ key: string }>>`
    SELECT DISTINCT jsonb_object_keys(metafields) AS key
    FROM "Product" WHERE ${buildProductWhere({ category })} LIMIT 20`;

  const facets: Record<string, Array<{ value: string; count: number }>> = {};
  for (const { key } of keyRows) {
    if (key === 'growth_type') continue; // tabs own growth type
    // counts for this section exclude its own selection (standard faceting)
    const otherFilters = { ...(filters ?? {}) };
    delete otherFilters[key];
    const sectionWhere = buildProductWhere({
      category,
      filters: Object.keys(otherFilters).length > 0 ? otherFilters : undefined,
      minPrice,
      maxPrice,
    });
    const rows = await prisma.$queryRaw<Array<{ value: string; count: number }>>`
      SELECT v.value AS value, COUNT(*)::int AS count
      FROM "Product",
           jsonb_array_elements_text(
             CASE WHEN jsonb_typeof(metafields->${key}) = 'array'
                  THEN metafields->${key} ELSE '[]'::jsonb END) v(value)
      WHERE ${sectionWhere}
      GROUP BY v.value
      ORDER BY count DESC, v.value ASC`;
    if (rows.length > 0) facets[key] = rows;
  }

  const result = {
    total: totalRows[0]?.count ?? 0,
    priceRange: { min: priceRows[0]?.min ?? null, max: priceRows[0]?.max ?? null },
    growthTypes,
    facets,
  };
  facetsCache.set(cacheKey, result);
  res.json(result);
});

router.get('/:handle', async (req: Request, res: Response) => {
  const product = await prisma.product.findUnique({
    where: { handle: req.params.handle as string },
    include: { variants: true },
  });
  if (!product) {
    res.status(404).json({ message: 'Product not found' });
    return;
  }
  res.json({ product });
});

export default router;
