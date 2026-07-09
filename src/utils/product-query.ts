import { Prisma } from '../generated/prisma/client';

export interface ProductFilterInput {
  category?: string;
  filters?: Record<string, string[]>;
  minPrice?: number;
  maxPrice?: number;
  type?: string;
}

/** Parses the `filters` query param: URL-decoded JSON `{key: [values]}`. */
export function parseFiltersParam(raw: unknown): Record<string, string[]> | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  try {
    const obj = JSON.parse(raw);
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return undefined;
    const out: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (!Array.isArray(v)) continue;
      const vals = v.filter((x): x is string => typeof x === 'string').slice(0, 50);
      if (vals.length > 0) out[k] = vals;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

// metafields values are stored as arrays of resolved label strings; guard the
// jsonb type because legacy webhook writes may have stored a bare string.
function metafieldArray(key: string): Prisma.Sql {
  return Prisma.sql`(CASE WHEN jsonb_typeof(metafields->${key}) = 'array'
    THEN metafields->${key} ELSE '[]'::jsonb END)`;
}

function growthMatch(pattern: string): Prisma.Sql {
  return Prisma.sql`EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(${metafieldArray('growth_type')}) gt(v)
    WHERE lower(gt.v) LIKE ${pattern}
  )`;
}

const HAS_GROWTH = Prisma.sql`(jsonb_typeof(metafields->'growth_type') = 'array'
  AND jsonb_array_length(metafields->'growth_type') > 0)`;

const TAG_LAB = Prisma.sql`EXISTS (SELECT 1 FROM unnest(tags) tag
  WHERE tag ILIKE '%lab grown%' OR tag ILIKE '%lab-grown%')`;
const TAG_MOISS = Prisma.sql`EXISTS (SELECT 1 FROM unnest(tags) tag
  WHERE tag ILIKE '%moissanite%')`;

/**
 * Growth-type category → SQL. Matches resolved labels case-insensitively
 * (hpht/cvd/lab → Lab Grown, etc.); products with no growth_type metafield
 * fall back to legacy tag matching so they don't vanish mid-transition.
 */
export function categoryCondition(category: string): Prisma.Sql | null {
  const labGrown = Prisma.sql`(${growthMatch('%hpht%')} OR ${growthMatch('%cvd%')} OR ${growthMatch('%lab grown%')} OR ${growthMatch('%lab-grown%')})`;
  const moissanite = growthMatch('%moissanite%');
  const natural = growthMatch('%natural%');
  const gemstone = growthMatch('%gem%');

  switch (category) {
    case 'lab-grown':
      return Prisma.sql`(${labGrown} OR (NOT ${HAS_GROWTH} AND ${TAG_LAB}))`;
    case 'moissanite':
      return Prisma.sql`(${moissanite} OR (NOT ${HAS_GROWTH} AND ${TAG_MOISS} AND NOT ${TAG_LAB}))`;
    case 'natural':
      return natural;
    case 'gemstone':
      return gemstone;
    case 'other':
      return Prisma.sql`(NOT (${labGrown} OR ${moissanite} OR ${natural} OR ${gemstone})
        AND (${HAS_GROWTH} OR NOT (${TAG_LAB} OR ${TAG_MOISS})))`;
    default:
      return null;
  }
}

/** One condition per section: product must have ANY of the selected values. */
export function filtersConditions(filters: Record<string, string[]>): Prisma.Sql[] {
  return Object.entries(filters).map(
    ([key, values]) => Prisma.sql`jsonb_exists_any(${metafieldArray(key)}, ${values})`
  );
}

export function buildProductWhere(input: ProductFilterInput): Prisma.Sql {
  const conds: Prisma.Sql[] = [Prisma.sql`"availableForSale" = true`];
  if (input.type) conds.push(Prisma.sql`"productType" = ${input.type}`);
  if (input.category) {
    const c = categoryCondition(input.category);
    if (c) conds.push(c);
  }
  if (input.filters) conds.push(...filtersConditions(input.filters));
  if (input.minPrice !== undefined) conds.push(Prisma.sql`"minPrice" >= ${input.minPrice}`);
  if (input.maxPrice !== undefined) conds.push(Prisma.sql`"minPrice" <= ${input.maxPrice}`);
  return Prisma.join(conds, ' AND ');
}
