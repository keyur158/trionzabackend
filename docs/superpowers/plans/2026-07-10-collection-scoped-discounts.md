# Collection- and Product-Scoped Discounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Shopify discount codes restricted to specific collections or products work in the app, applying the discount only to the eligible portion of the cart.

**Architecture:** `shopify-discount.ts` parses each code's scope (all / collections / products) from the Admin API. A new `discount-apply.ts` computes the eligible subtotal via the existing local `CollectionProduct` table and returns the monetary discount. `checkout.ts` wires both into `computeTotals` and `validate-coupon`; `shopify-order.ts` sends scoped discounts to Shopify as a fixed amount so the order matches the PayPal charge.

**Tech Stack:** Node/TypeScript, Express, Prisma (Postgres), Jest + supertest, Shopify Admin GraphQL API.

## Global Constraints

- Fail closed: any Shopify API/GraphQL failure in discount validation returns `{ ok: false, status: 503, message: "Couldn't verify the code right now. Please try again." }`. Never accept or silently ignore a code on API failure.
- Money to Shopify and to PayPal must agree to the penny; round computed discounts to cents (`Math.round(x * 100) / 100`).
- Collection and product IDs are stored in the DB as the **numeric** Shopify ID (e.g. `"456"`), extracted from the gid with `gid.split('/').pop()`. Match on numeric IDs.
- All 22 existing tests must stay green (some are updated in this plan; none are deleted).
- Work on branch `feature/collection-scoped-discounts` in `/Users/visibrix/Documents/APP/TrionzaApp/TrionzaDiamond/server`. Run all commands from that directory.
- No DB migration — `CollectionProduct` already exists.

---

### Task 1: Parse discount scope in `shopify-discount.ts`

**Files:**
- Modify: `src/services/shopify-discount.ts`
- Test: `src/__tests__/shopifyDiscount.test.ts` (update existing + add cases)

**Interfaces:**
- Produces:
  - `export type DiscountScope = { kind: 'all' } | { kind: 'collections'; ids: string[] } | { kind: 'products'; ids: string[] }`
  - `ValidatedDiscount` gains `scope: DiscountScope`.
  - `validateShopifyDiscount(code: string, subtotal: number): Promise<DiscountValidation>` — signature unchanged.

- [ ] **Step 1: Update existing tests for the new `scope` field**

In `src/__tests__/shopifyDiscount.test.ts`, the two success assertions now include `scope`. Replace the body of the first test (`accepts an active percentage code…`) expected object:

```ts
    expect(r).toEqual({
      ok: true,
      discount: { code: 'SAVE10', discountType: 'percentage', discountValue: 10, minOrderValue: null, scope: { kind: 'all' } },
    });
```

Replace the `accepts a fixed-amount code` expected object:

```ts
    expect(r).toEqual({
      ok: true,
      discount: { code: 'FLAT50', discountType: 'fixed', discountValue: 50, minOrderValue: null, scope: { kind: 'all' } },
    });
```

- [ ] **Step 2: Convert the "rejects product-scoped codes" test into an acceptance test**

Replace the whole `it('rejects product-scoped codes', …)` block (lines ~100-110) with:

```ts
  it('parses product-scoped codes into a products scope', async () => {
    mockGraphQL.mockResolvedValueOnce(basicDiscount({
      customerGets: {
        value: { __typename: 'DiscountPercentage', percentage: 0.1 },
        items: {
          __typename: 'DiscountProducts',
          products: { nodes: [{ id: 'gid://shopify/Product/456' }], pageInfo: { hasNextPage: false, endCursor: null } },
          productVariants: { nodes: [{ product: { id: 'gid://shopify/Product/789' } }], pageInfo: { hasNextPage: false, endCursor: null } },
        },
      },
    }));
    const r = await validateShopifyDiscount('PROD', 500);
    expect(r).toMatchObject({ ok: true, discount: { scope: { kind: 'products', ids: ['456', '789'] } } });
  });

  it('parses collection-scoped codes into a collections scope', async () => {
    mockGraphQL.mockResolvedValueOnce(basicDiscount({
      customerGets: {
        value: { __typename: 'DiscountPercentage', percentage: 0.1 },
        items: {
          __typename: 'DiscountCollections',
          collections: { nodes: [{ id: 'gid://shopify/Collection/11' }, { id: 'gid://shopify/Collection/22' }], pageInfo: { hasNextPage: false, endCursor: null } },
        },
      },
    }));
    const r = await validateShopifyDiscount('COLL', 500);
    expect(r).toMatchObject({ ok: true, discount: { scope: { kind: 'collections', ids: ['11', '22'] } } });
  });

  it('paginates a collection scope that spans multiple pages', async () => {
    mockGraphQL
      .mockResolvedValueOnce(basicDiscount({
        customerGets: {
          value: { __typename: 'DiscountPercentage', percentage: 0.1 },
          items: {
            __typename: 'DiscountCollections',
            collections: { nodes: [{ id: 'gid://shopify/Collection/11' }], pageInfo: { hasNextPage: true, endCursor: 'CURSOR1' } },
          },
        },
      }))
      .mockResolvedValueOnce({
        data: { codeDiscountNode: { codeDiscount: { customerGets: { items: {
          collections: { nodes: [{ id: 'gid://shopify/Collection/22' }], pageInfo: { hasNextPage: false, endCursor: null } },
        } } } } },
      });
    const r = await validateShopifyDiscount('COLL', 500);
    expect(r).toMatchObject({ ok: true, discount: { scope: { kind: 'collections', ids: ['11', '22'] } } });
  });
```

Also update the `basicDiscount` fixture's `id` so the node has one (pagination reads it). Change the `codeDiscountNodeByCode` object to include an `id`:

```ts
      codeDiscountNodeByCode: {
        id: 'gid://shopify/DiscountCodeNode/1',
        codeDiscount: {
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx jest shopifyDiscount`
Expected: FAIL — success tests now expect `scope`, and the new collection/product/pagination tests fail because scope parsing doesn't exist yet.

- [ ] **Step 4: Implement scope parsing in `src/services/shopify-discount.ts`**

Add the type and export near the top, after the imports:

```ts
export type DiscountScope =
  | { kind: 'all' }
  | { kind: 'collections'; ids: string[] }
  | { kind: 'products'; ids: string[] };

function numericId(gid: string): string {
  return gid.split('/').pop() ?? gid;
}
```

Add `scope` to the `ValidatedDiscount` interface:

```ts
export interface ValidatedDiscount {
  code: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number; // 10 => 10% off; 50 => $50 off
  minOrderValue: number | null;
  scope: DiscountScope;
}
```

Replace `DISCOUNT_QUERY` so it reads the node id and the item scope:

```ts
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
```

Add pagination helpers (before `validateShopifyDiscount`):

```ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function collectCollectionIds(nodeId: string, items: any): Promise<string[]> {
  const ids = items.collections.nodes.map((n: { id: string }) => numericId(n.id));
  let pageInfo = items.collections.pageInfo;
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
    const conn = res.data?.codeDiscountNode?.codeDiscount?.customerGets?.items?.collections;
    if (!conn) break;
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
      const conn = res.data?.codeDiscountNode?.codeDiscount?.customerGets?.items?.[p.field];
      if (!conn) break;
      for (const n of conn.nodes) ids.add(p.field === 'products' ? numericId(n.id) : numericId(n.product.id));
      pageInfo = conn.pageInfo;
    }
  }
  return [...ids];
}
```

In `validateShopifyDiscount`, capture the node id and replace the `AllDiscountItems`-only check (current lines ~92-98) with scope parsing. Change:

```ts
  const d = data.data?.codeDiscountNodeByCode?.codeDiscount;
  if (!d) return { ok: false, status: 404, message: 'Invalid discount code' };
```
to:
```ts
  const node = data.data?.codeDiscountNodeByCode;
  const d = node?.codeDiscount;
  if (!d) return { ok: false, status: 404, message: 'Invalid discount code' };
```

Replace the block:
```ts
  if (d.customerGets?.items?.__typename !== 'AllDiscountItems') {
    return {
      ok: false,
      status: 400,
      message: "This code applies to specific products and isn't supported in the app",
    };
  }
```
with:
```ts
  const items = d.customerGets?.items;
  let scope: DiscountScope;
  if (items?.__typename === 'AllDiscountItems') {
    scope = { kind: 'all' };
  } else if (items?.__typename === 'DiscountCollections') {
    scope = { kind: 'collections', ids: await collectCollectionIds(node.id, items) };
  } else if (items?.__typename === 'DiscountProducts') {
    scope = { kind: 'products', ids: await collectProductIds(node.id, items) };
  } else {
    return { ok: false, status: 400, message: "This code type isn't supported in the app" };
  }
```

Add `scope` to both success returns (percentage and fixed branches). In the `DiscountPercentage` branch:
```ts
    return {
      ok: true,
      discount: { code, discountType: 'percentage', discountValue: value.percentage * 100, minOrderValue, scope },
    };
```
In the `DiscountAmount` branch:
```ts
    return {
      ok: true,
      discount: { code, discountType: 'fixed', discountValue: parseFloat(value.amount.amount), minOrderValue, scope },
    };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest shopifyDiscount`
Expected: PASS (all cases, including pagination).

- [ ] **Step 6: Commit**

```bash
git add src/services/shopify-discount.ts src/__tests__/shopifyDiscount.test.ts
git commit -m "feat(discount): parse collection/product scope from Shopify codes"
```

---

### Task 2: Compute the eligible discount amount (`discount-apply.ts`)

**Files:**
- Create: `src/services/discount-apply.ts`
- Test: `src/__tests__/discountApply.test.ts`

**Interfaces:**
- Consumes: `ValidatedDiscount`, `DiscountScope` from `./shopify-discount`; `prisma.collectionProduct.findMany` from `../config/database`.
- Produces:
  - `export interface CartLine { productId: string; price: number; quantity: number }`
  - `export class DiscountNotApplicableError extends Error { statusCode: number }`
  - `export async function computeDiscountAmount(discount: ValidatedDiscount, lines: CartLine[]): Promise<number>` — returns the cents-rounded discount; throws `DiscountNotApplicableError` (statusCode 400) when a scoped code matches no cart item.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/discountApply.test.ts`:

```ts
jest.mock('../config/database', () => ({
  prisma: { collectionProduct: { findMany: jest.fn() } },
}));

import { prisma } from '../config/database';
import { computeDiscountAmount, DiscountNotApplicableError } from '../services/discount-apply';
import { ValidatedDiscount } from '../services/shopify-discount';

const findMany = prisma.collectionProduct.findMany as jest.Mock;

function discount(overrides: Partial<ValidatedDiscount> = {}): ValidatedDiscount {
  return { code: 'C', discountType: 'percentage', discountValue: 10, minOrderValue: null, scope: { kind: 'all' }, ...overrides };
}

const lines = [
  { productId: 'p1', price: 800, quantity: 1 },
  { productId: 'p2', price: 500, quantity: 1 },
];

describe('computeDiscountAmount', () => {
  beforeEach(() => jest.clearAllMocks());

  it('percentage over the whole cart for an all-items code', async () => {
    const amount = await computeDiscountAmount(discount(), lines);
    expect(amount).toBe(130); // 10% of 1300
  });

  it('percentage over eligible collection items only', async () => {
    findMany.mockResolvedValue([{ productId: 'p1' }]); // only p1 is in the collection
    const amount = await computeDiscountAmount(
      discount({ scope: { kind: 'collections', ids: ['c1'] } }),
      lines,
    );
    expect(amount).toBe(80); // 10% of 800
    expect(findMany).toHaveBeenCalledWith({
      where: { collectionId: { in: ['c1'] }, productId: { in: ['p1', 'p2'] } },
      select: { productId: true },
    });
  });

  it('percentage over eligible product-scoped items only', async () => {
    const amount = await computeDiscountAmount(
      discount({ scope: { kind: 'products', ids: ['p2'] } }),
      lines,
    );
    expect(amount).toBe(50); // 10% of 500
    expect(findMany).not.toHaveBeenCalled();
  });

  it('caps a fixed code at the eligible subtotal', async () => {
    const amount = await computeDiscountAmount(
      discount({ discountType: 'fixed', discountValue: 900, scope: { kind: 'products', ids: ['p2'] } }),
      lines,
    );
    expect(amount).toBe(500); // min(900, 500 eligible)
  });

  it('rounds to cents', async () => {
    const amount = await computeDiscountAmount(
      discount({ discountValue: 15 }),
      [{ productId: 'p1', price: 33.33, quantity: 1 }],
    );
    expect(amount).toBe(5); // 15% of 33.33 = 4.9995 -> 5.00
  });

  it('throws 400 when a scoped code matches nothing in the cart', async () => {
    findMany.mockResolvedValue([]);
    await expect(
      computeDiscountAmount(discount({ scope: { kind: 'collections', ids: ['cX'] } }), lines),
    ).rejects.toMatchObject({ statusCode: 400, message: "This code applies to select items that aren't in your cart." });
    await expect(
      computeDiscountAmount(discount({ scope: { kind: 'collections', ids: ['cX'] } }), lines),
    ).rejects.toBeInstanceOf(DiscountNotApplicableError);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest discountApply`
Expected: FAIL — module `../services/discount-apply` does not exist.

- [ ] **Step 3: Implement `src/services/discount-apply.ts`**

```ts
import { prisma } from '../config/database';
import { ValidatedDiscount, DiscountScope } from './shopify-discount';

export interface CartLine {
  productId: string;
  price: number;
  quantity: number;
}

export class DiscountNotApplicableError extends Error {
  statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'DiscountNotApplicableError';
  }
}

const lineTotal = (l: CartLine) => l.price * l.quantity;

async function eligibleSubtotal(scope: DiscountScope, lines: CartLine[]): Promise<number> {
  if (scope.kind === 'all') {
    return lines.reduce((s, l) => s + lineTotal(l), 0);
  }
  if (scope.kind === 'products') {
    const ids = new Set(scope.ids);
    return lines.filter(l => ids.has(l.productId)).reduce((s, l) => s + lineTotal(l), 0);
  }
  // collections — resolve membership via the local join table
  const cartProductIds = lines.map(l => l.productId);
  if (cartProductIds.length === 0) return 0;
  const rows = await prisma.collectionProduct.findMany({
    where: { collectionId: { in: scope.ids }, productId: { in: cartProductIds } },
    select: { productId: true },
  });
  const eligible = new Set(rows.map(r => r.productId));
  return lines.filter(l => eligible.has(l.productId)).reduce((s, l) => s + lineTotal(l), 0);
}

/**
 * Returns the monetary discount to apply, based on the eligible portion of the
 * cart. Throws DiscountNotApplicableError (400) when a scoped code matches no
 * item in the cart.
 */
export async function computeDiscountAmount(discount: ValidatedDiscount, lines: CartLine[]): Promise<number> {
  const subtotal = await eligibleSubtotal(discount.scope, lines);
  if (discount.scope.kind !== 'all' && subtotal === 0) {
    throw new DiscountNotApplicableError("This code applies to select items that aren't in your cart.");
  }
  const raw = discount.discountType === 'percentage'
    ? (subtotal * discount.discountValue) / 100
    : Math.min(discount.discountValue, subtotal);
  return Math.round(raw * 100) / 100;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest discountApply`
Expected: PASS (all 6 cases).

- [ ] **Step 5: Commit**

```bash
git add src/services/discount-apply.ts src/__tests__/discountApply.test.ts
git commit -m "feat(discount): compute eligible-only discount amount"
```

---

### Task 3: Wire eligibility into `checkout.ts`

**Files:**
- Modify: `src/routes/checkout.ts`
- Test: `src/__tests__/checkoutDiscount.test.ts`

**Interfaces:**
- Consumes: `computeDiscountAmount`, `CartLine` from `../services/discount-apply`.

- [ ] **Step 1: Update the checkout tests for scope + eligibility**

In `src/__tests__/checkoutDiscount.test.ts`:

(a) Add `collectionProduct` to the prisma mock:
```ts
jest.mock('../config/database', () => ({
  prisma: {
    cart: { findUnique: jest.fn() },
    shippingRate: { findUnique: jest.fn() },
    collectionProduct: { findMany: jest.fn() },
  },
}));
```

(b) Give cart items a `productId` in the `cartWith` helper:
```ts
function cartWith(price: number, qty = 1) {
  return {
    id: 1,
    items: [{
      productId: 'p1',
      quantity: qty,
      variant: { id: 'v1', title: 'V', price, availableForSale: true, inventoryQty: 5 },
      product: { title: 'P', images: [] },
    }],
  };
}
```

(c) Add `scope: { kind: 'all' }` to every `mockValidate.mockResolvedValue({ ok: true, discount: {...} })` in the file (the two `/calculate` success tests and the `validate-coupon` success test). Example for the first:
```ts
    mockValidate.mockResolvedValue({
      ok: true,
      discount: { code: 'SAVE10', discountType: 'percentage', discountValue: 10, minOrderValue: null, scope: { kind: 'all' } },
    });
```

(d) The `validate-coupon` success test now also returns the applied amount. Replace its expected body:
```ts
    expect(res.body).toEqual({
      code: 'SAVE10', discountType: 'percentage', discountValue: 10, minOrderValue: null, discountAmount: '50.00',
    });
```

(e) Add a new test at the end of the `validate-coupon` describe block:
```ts
  it('rejects a collection-scoped code with no eligible cart items', async () => {
    (prisma.collectionProduct.findMany as jest.Mock).mockResolvedValue([]);
    mockValidate.mockResolvedValue({
      ok: true,
      discount: { code: 'COLL', discountType: 'percentage', discountValue: 10, minOrderValue: null, scope: { kind: 'collections', ids: ['cX'] } },
    });
    const res = await request(app).post('/api/checkout/validate-coupon').send({ code: 'COLL' });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("aren't in your cart");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest checkoutDiscount`
Expected: FAIL — `validate-coupon` doesn't return `discountAmount`; the new scoped-rejection test isn't handled.

- [ ] **Step 3: Wire `computeDiscountAmount` into `computeTotals`**

In `src/routes/checkout.ts`, add the import:
```ts
import { computeDiscountAmount } from '../services/discount-apply';
```

Replace the discount block in `computeTotals` (current lines ~53-68):
```ts
  let discountAmount = 0;
  let discount: ValidatedDiscount | null = null;
  if (couponCode) {
    const validation = await validateShopifyDiscount(String(couponCode).trim(), subtotal);
    if (!validation.ok) {
      const err = new Error(validation.message) as Error & { statusCode?: number };
      err.statusCode = validation.status;
      throw err;
    }
    discount = validation.discount;
    discountAmount = discount.discountType === 'percentage'
      ? (subtotal * discount.discountValue) / 100
      : Math.min(discount.discountValue, subtotal);
  }
```
with:
```ts
  let discountAmount = 0;
  let discount: ValidatedDiscount | null = null;
  if (couponCode) {
    const validation = await validateShopifyDiscount(String(couponCode).trim(), subtotal);
    if (!validation.ok) {
      const err = new Error(validation.message) as Error & { statusCode?: number };
      err.statusCode = validation.status;
      throw err;
    }
    discount = validation.discount;
    discountAmount = await computeDiscountAmount(discount, cart.items.map((i: { productId: string; quantity: number; variant: { price: unknown } }) => ({
      productId: i.productId,
      price: Number(i.variant.price),
      quantity: i.quantity,
    })));
  }
```

(`computeDiscountAmount` throws `DiscountNotApplicableError` with `statusCode = 400`, which the existing route `catch` blocks already read via `err.statusCode`.)

- [ ] **Step 4: Wire eligibility into `validate-coupon`**

Replace the `validate-coupon` handler body (current lines ~103-129). New version loads `productId`/`quantity`, computes the amount, and rejects non-applicable codes:
```ts
router.post('/validate-coupon', requireAuth, async (req: Request, res: Response) => {
  const { code } = req.body;
  if (!code) {
    res.status(400).json({ message: 'code is required' });
    return;
  }
  const cart = await prisma.cart.findUnique({
    where: { customerId: req.user!.id },
    include: { items: { select: { productId: true, quantity: true, variant: { select: { price: true } } } } },
  });
  const lines = (cart?.items ?? []).map(i => ({
    productId: i.productId,
    price: Number(i.variant.price),
    quantity: i.quantity,
  }));
  const subtotal = lines.reduce((sum, l) => sum + l.price * l.quantity, 0);

  const validation = await validateShopifyDiscount(String(code).trim(), subtotal);
  if (!validation.ok) {
    res.status(validation.status).json({ message: validation.message });
    return;
  }
  const d = validation.discount;

  let discountAmount: number;
  try {
    discountAmount = await computeDiscountAmount(d, lines);
  } catch (err: unknown) {
    const status = (err as { statusCode?: number })?.statusCode ?? 400;
    res.status(status).json({ message: err instanceof Error ? err.message : 'Invalid discount code' });
    return;
  }

  res.json({
    code: d.code,
    discountType: d.discountType,
    discountValue: d.discountValue,
    minOrderValue: d.minOrderValue,
    discountAmount: discountAmount.toFixed(2),
  });
});
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest checkoutDiscount`
Expected: PASS (including the new scoped-rejection test).

- [ ] **Step 6: Commit**

```bash
git add src/routes/checkout.ts src/__tests__/checkoutDiscount.test.ts
git commit -m "feat(checkout): apply discounts to eligible cart items only"
```

---

### Task 4: Send scoped discounts to Shopify as a fixed amount

**Files:**
- Modify: `src/services/shopify-order.ts`
- Test: `src/__tests__/shopifyOrderDiscount.test.ts`

**Interfaces:**
- Consumes: `ValidatedDiscount.scope` from `./shopify-discount`.

- [ ] **Step 1: Add a test for scoped-percentage → fixed**

In `src/__tests__/shopifyOrderDiscount.test.ts`, add this test inside the describe block:
```ts
  it('sends itemFixedDiscountCode for a scoped percentage discount', async () => {
    await createShopifyOrder({
      ...baseInput,
      discount: { code: 'TEST10', discountType: 'percentage', discountValue: 10, minOrderValue: null, scope: { kind: 'collections', ids: ['11'] } },
      appliedDiscountAmount: 80,
    });
    const variables = mockGraphQL.mock.calls[0][1];
    expect(variables.order.discountCode).toEqual({
      itemFixedDiscountCode: {
        code: 'TEST10',
        amountSet: {
          shopMoney: { amount: '80.00', currencyCode: 'USD' },
          presentmentMoney: { amount: '80.00', currencyCode: 'USD' },
        },
      },
    });
  });
```

(The existing tests pass discounts without a `scope` field; the implementation treats a missing scope as whole-order, so `itemPercentageDiscountCode` for `SAVE10` is unchanged.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest shopifyOrderDiscount`
Expected: FAIL — the scoped percentage code currently emits `itemPercentageDiscountCode`.

- [ ] **Step 3: Implement the fixed-vs-percentage branch**

In `src/services/shopify-order.ts`, add a helper above `createShopifyOrder`:
```ts
function buildDiscountCode(discount: ValidatedDiscount, appliedAmount?: number) {
  const scoped = discount.scope && discount.scope.kind !== 'all';
  if (!scoped && discount.discountType === 'percentage') {
    return { itemPercentageDiscountCode: { code: discount.code, percentage: discount.discountValue } };
  }
  const amount = (appliedAmount ?? discount.discountValue).toFixed(2);
  return {
    itemFixedDiscountCode: {
      code: discount.code,
      amountSet: {
        shopMoney: { amount, currencyCode: 'USD' },
        presentmentMoney: { amount, currencyCode: 'USD' },
      },
    },
  };
}
```

Replace the inline `...(data.discount && { discountCode: … })` block (current lines ~67-91) with:
```ts
      ...(data.discount && { discountCode: buildDiscountCode(data.discount, data.appliedDiscountAmount) }),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest shopifyOrderDiscount`
Expected: PASS (existing percentage/fixed/cap/omit tests + the new scoped test).

- [ ] **Step 5: Commit**

```bash
git add src/services/shopify-order.ts src/__tests__/shopifyOrderDiscount.test.ts
git commit -m "feat(order): send scoped discounts to Shopify as fixed amount"
```

---

### Task 5: Full verification and build

**Files:** none (verification only).

- [ ] **Step 1: Run the entire test suite**

Run: `npx jest`
Expected: PASS — all suites green (the original 22 plus the new `discountApply` cases and the added scope tests).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: `prisma generate && tsc` completes with exit 0; `dist/services/discount-apply.js` exists.

- [ ] **Step 4: Commit any build artifacts only if the repo tracks `dist`**

```bash
git status --short
```
If `dist/` is tracked and changed, `git add dist && git commit -m "build: compile scoped-discount support"`. If `dist/` is gitignored, skip.

- [ ] **Step 5: Deployment note (manual, do not run blindly)**

Deploy to the droplet: sync the rebuilt `dist/` (or the source + `npm run build`) into `~/trionzabackend`, then `pm2 restart trionza-app --update-env`. Verify by applying `TEST10` on a cart that contains an item from its collection — the discount should apply to the eligible portion; applying it to a cart with no eligible items should show *"This code applies to select items that aren't in your cart."*

---

## Self-Review

**Spec coverage:**
- Scope parsing (collections + products, pagination, numeric IDs, AllDiscountItems→all, fail-closed) → Task 1. ✓
- Eligible-only amount, empty-eligible 400 rejection, fixed cap, cents rounding → Task 2. ✓
- `computeTotals` + `validate-coupon` wiring, both order paths inherit via `computeTotals` → Task 3. ✓
- Shopify order fixed-amount for scoped/fixed, percentage unchanged for whole-order → Task 4. ✓
- Testing across all suites, 22 existing stay green → Tasks 1-5. ✓
- Rollout (code-only, deploy + restart) → Task 5 Step 5. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `DiscountScope`/`ValidatedDiscount.scope` (Task 1) consumed by `computeDiscountAmount`/`CartLine` (Task 2), consumed in Task 3, and `scope` read in Task 4 `buildDiscountCode`. `DiscountNotApplicableError.statusCode` (Task 2) consumed by existing route catch blocks (Task 3). Names consistent across tasks. ✓
