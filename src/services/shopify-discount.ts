import { shopifyGraphQL } from '../config/shopify';

export type DiscountScope =
  | { kind: 'all' }
  | { kind: 'collections'; ids: string[] }
  | { kind: 'products'; ids: string[] };

function numericId(gid: string): string {
  return gid.split('/').pop() ?? gid;
}

export interface ValidatedDiscount {
  code: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number; // 10 => 10% off; 50 => $50 off
  minOrderValue: number | null;
  scope: DiscountScope;
}

export type DiscountValidation =
  | { ok: true; discount: ValidatedDiscount }
  | { ok: false; status: number; message: string };

const DISCOUNT_QUERY = `
  query DiscountByCode($code: String!) {
    codeDiscountNodeByCode(code: $code) {
      id
      codeDiscount {
        __typename
        ... on DiscountCodeBasic {
          title
          status
          startsAt
          endsAt
          usageLimit
          asyncUsageCount
          customerGets {
            value {
              __typename
              ... on DiscountPercentage { percentage }
              ... on DiscountAmount { amount { amount currencyCode } }
            }
            items {
              __typename
              ... on DiscountCollections {
                collections(first: 250) { nodes { id } pageInfo { hasNextPage endCursor } }
              }
              ... on DiscountProducts {
                products(first: 250) { nodes { id } pageInfo { hasNextPage endCursor } }
                productVariants(first: 250) { nodes { product { id } } pageInfo { hasNextPage endCursor } }
              }
            }
          }
          minimumRequirement {
            __typename
            ... on DiscountMinimumSubtotal { greaterThanOrEqualToSubtotal { amount } }
          }
        }
      }
    }
  }
`;

const UNAVAILABLE: DiscountValidation = {
  ok: false,
  status: 503,
  message: "Couldn't verify the code right now. Please try again.",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function collectCollectionIds(nodeId: string, items: any): Promise<string[]> {
  const ids = (items.collections?.nodes ?? []).map((n: { id: string }) => numericId(n.id));
  let pageInfo = items.collections?.pageInfo;
  let guard = 0;
  while (pageInfo?.hasNextPage && guard++ < 50) {
    const q = `
      query Page($id: ID!, $after: String) {
        codeDiscountNode(id: $id) {
          codeDiscount {
            ... on DiscountCodeBasic {
              customerGets { items { ... on DiscountCollections {
                collections(first: 250, after: $after) { nodes { id } pageInfo { hasNextPage endCursor } }
              } } }
            }
          }
        }
      }`;
    const res = await shopifyGraphQL(q, { id: nodeId, after: pageInfo.endCursor });
    if (res.errors) throw new Error('Shopify discount scope pagination returned errors');
    const conn = res.data?.codeDiscountNode?.codeDiscount?.customerGets?.items?.collections;
    if (!conn) throw new Error('Shopify discount scope pagination missing connection');
    ids.push(...conn.nodes.map((n: { id: string }) => numericId(n.id)));
    pageInfo = conn.pageInfo;
  }
  return ids;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function collectProductIds(nodeId: string, items: any): Promise<string[]> {
  const ids = new Set<string>();
  for (const n of items.products?.nodes ?? []) ids.add(numericId(n.id));
  for (const n of items.productVariants?.nodes ?? []) ids.add(numericId(n.product.id));

  const pages: Array<{ field: 'products' | 'productVariants'; pageInfo: { hasNextPage: boolean; endCursor: string | null } }> = [
    { field: 'products', pageInfo: items.products?.pageInfo },
    { field: 'productVariants', pageInfo: items.productVariants?.pageInfo },
  ];
  for (const p of pages) {
    let pageInfo = p.pageInfo;
    let guard = 0;
    while (pageInfo?.hasNextPage && guard++ < 50) {
      const inner = p.field === 'products'
        ? `products(first: 250, after: $after) { nodes { id } pageInfo { hasNextPage endCursor } }`
        : `productVariants(first: 250, after: $after) { nodes { product { id } } pageInfo { hasNextPage endCursor } }`;
      const q = `
        query Page($id: ID!, $after: String) {
          codeDiscountNode(id: $id) {
            codeDiscount { ... on DiscountCodeBasic { customerGets { items { ... on DiscountProducts { ${inner} } } } } }
          }
        }`;
      const res = await shopifyGraphQL(q, { id: nodeId, after: pageInfo.endCursor });
      if (res.errors) throw new Error('Shopify discount scope pagination returned errors');
      const conn = res.data?.codeDiscountNode?.codeDiscount?.customerGets?.items?.[p.field];
      if (!conn) throw new Error('Shopify discount scope pagination missing connection');
      for (const n of conn.nodes) ids.add(p.field === 'products' ? numericId(n.id) : numericId(n.product.id));
      pageInfo = conn.pageInfo;
    }
  }
  return [...ids];
}

/**
 * Validates a Shopify discount code against the Admin API. Only
 * "Amount off order" (DiscountCodeBasic, all items/collections/products)
 * codes are supported.
 * Fails CLOSED: any API failure returns 503 rather than accepting/ignoring.
 */
export async function validateShopifyDiscount(
  code: string,
  subtotal: number
): Promise<DiscountValidation> {
  let data;
  try {
    data = await shopifyGraphQL(DISCOUNT_QUERY, { code });
  } catch (err) {
    console.error('Shopify discount lookup failed:', err);
    return UNAVAILABLE;
  }
  if (data.errors) {
    console.error('Shopify discount lookup errors:', data.errors);
    return UNAVAILABLE;
  }

  const node = data.data?.codeDiscountNodeByCode;
  const d = node?.codeDiscount;
  if (!d) return { ok: false, status: 404, message: 'Invalid discount code' };

  if (d.__typename !== 'DiscountCodeBasic') {
    return { ok: false, status: 400, message: "This code type isn't supported in the app" };
  }
  if (d.status !== 'ACTIVE') {
    return d.status === 'EXPIRED'
      ? { ok: false, status: 400, message: 'This code has expired' }
      : { ok: false, status: 400, message: 'This code is not active' };
  }
  const now = new Date();
  if (d.startsAt && new Date(d.startsAt) > now) {
    return { ok: false, status: 400, message: 'This code is not active yet' };
  }
  if (d.endsAt && new Date(d.endsAt) < now) {
    return { ok: false, status: 400, message: 'This code has expired' };
  }
  if (d.usageLimit != null && d.asyncUsageCount >= d.usageLimit) {
    return { ok: false, status: 400, message: 'This code has reached its usage limit' };
  }
  const items = d.customerGets?.items;
  let scope: DiscountScope;
  try {
    if (items?.__typename === 'AllDiscountItems') {
      scope = { kind: 'all' };
    } else if (items?.__typename === 'DiscountCollections') {
      scope = { kind: 'collections', ids: await collectCollectionIds(node.id, items) };
    } else if (items?.__typename === 'DiscountProducts') {
      scope = { kind: 'products', ids: await collectProductIds(node.id, items) };
    } else {
      return { ok: false, status: 400, message: "This code type isn't supported in the app" };
    }
  } catch (err) {
    console.error('Shopify discount scope pagination failed:', err);
    return UNAVAILABLE;
  }

  let minOrderValue: number | null = null;
  if (d.minimumRequirement) {
    if (d.minimumRequirement.__typename !== 'DiscountMinimumSubtotal') {
      return { ok: false, status: 400, message: "This code type isn't supported in the app" };
    }
    minOrderValue = parseFloat(d.minimumRequirement.greaterThanOrEqualToSubtotal.amount);
    if (subtotal < minOrderValue) {
      return {
        ok: false,
        status: 400,
        message: `This code requires a minimum order of $${minOrderValue.toFixed(2)}`,
      };
    }
  }

  const value = d.customerGets?.value;
  if (value?.__typename === 'DiscountPercentage') {
    // Shopify returns a 0..1 fraction (0.1 = 10%)
    return {
      ok: true,
      discount: {
        code,
        discountType: 'percentage',
        discountValue: value.percentage * 100,
        minOrderValue,
        scope,
      },
    };
  }
  if (value?.__typename === 'DiscountAmount') {
    return {
      ok: true,
      discount: {
        code,
        discountType: 'fixed',
        discountValue: parseFloat(value.amount.amount),
        minOrderValue,
        scope,
      },
    };
  }
  return { ok: false, status: 400, message: "This code type isn't supported in the app" };
}
