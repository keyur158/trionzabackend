# Collection- and Product-Scoped Discount Support

**Date:** 2026-07-10
**Status:** Approved design, pending implementation
**Area:** `server` — checkout discount validation and application

## Problem

The app rejects any Shopify discount code that is restricted to specific
collections or products. `shopify-discount.ts` only accepts codes whose
`customerGets.items` is `AllDiscountItems` (whole-order); anything scoped
returns *"This code applies to specific products and isn't supported in the
app,"* which the app surfaces as a generic "Invalid Coupon."

The store's real codes (`TEST10`, `WELCOME5`) are `DiscountCollections`
percentage codes, so they never work in the app.

## Goal

Support discount codes scoped to specific collections **and** specific
products, applying the discount only to the eligible portion of the cart —
matching how Shopify's own storefront computes it — across all three checkout
touchpoints: `validate-coupon`, `calculate`, and order creation (PayPal and the
second order path).

## Non-goals

- Buy-X-get-Y (`DiscountCodeBxgy`), free-shipping, and automatic (non-code)
  discounts remain unsupported.
- Minimum *quantity* requirements (`DiscountMinimumQuantity`) remain
  unsupported; only `DiscountMinimumSubtotal` is handled (unchanged).
- No changes to how discounts are displayed in the Flutter app beyond the
  existing success/error snackbars.

## Key facts that shape the design

- The local Postgres already has a `CollectionProduct` join table mapping
  products to collections, populated by `shopify-sync.ts`. Both `Product.id`
  and `Collection.id` are stored as the **numeric** Shopify ID (the sync calls
  `extractId(gid)` = `gid.split('/').pop()`).
- Therefore cart-item → collection membership is a single local DB query. The
  only new data needed from Shopify is the list of collection/product IDs
  attached to the discount.
- Shopify's `orderCreate` `discountCode.itemPercentageDiscountCode` applies the
  percentage to the **whole order**. For a scoped code that would diverge from
  the eligible-only amount we charge via PayPal, so scoped discounts must be
  sent to Shopify as a fixed amount equal to the computed eligible discount.

## Design

### 1. Discount scope — `services/shopify-discount.ts`

Add a scope discriminated union and include it on `ValidatedDiscount`:

```ts
export type DiscountScope =
  | { kind: 'all' }
  | { kind: 'collections'; ids: string[] }
  | { kind: 'products'; ids: string[] };

export interface ValidatedDiscount {
  code: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  minOrderValue: number | null;
  scope: DiscountScope; // NEW
}
```

- Extend `DISCOUNT_QUERY` `customerGets.items` to read:
  - `... on AllDiscountItems { allItems }` → `{ kind: 'all' }`
  - `... on DiscountCollections { collections(first: 50) { nodes { id } pageInfo { hasNextPage endCursor } } }`
  - `... on DiscountProducts { products(first: 100) { nodes { id } pageInfo {...} } productVariants(first: 100) { nodes { product { id } } pageInfo {...} } }`
- IDs are converted to numeric form with the same `extractId` logic used by the
  sync, so they match `Collection.id` / `Product.id` in the DB.
- **Pagination:** if any scope list reports `hasNextPage`, follow cursors until
  exhausted (bounded safety cap, e.g. 50 pages) so large scopes are matched
  correctly. Product scope merges IDs from both `products` and
  `productVariants.product.id`, de-duplicated.
- The `AllDiscountItems` rejection at the current line 92 is removed; instead
  the scope is captured. All other validation (type, status, dates, usage
  limit, minimum subtotal) is unchanged. The `(code, subtotal)` signature is
  unchanged — `subtotal` still drives the minimum-purchase check against the
  **full** cart subtotal.
- Fail-closed behavior is preserved: any Shopify API/GraphQL failure still
  returns the 503 "Couldn't verify the code right now."

### 2. Eligibility and amount — new `services/discount-apply.ts`

```ts
interface CartLine { productId: string; price: number; quantity: number; }

// Returns the monetary discount to apply. Throws a 400-tagged Error when a
// scoped code matches nothing in the cart.
export async function computeDiscountAmount(
  discount: ValidatedDiscount,
  lines: CartLine[],
): Promise<number>;
```

- `eligibleSubtotal`:
  - `all` → sum of all line totals.
  - `collections` → `prisma.collectionProduct.findMany({ where: { collectionId: { in: scope.ids }, productId: { in: cartProductIds } }, select: { productId: true } })` → eligible product-ID set → sum matching line totals.
  - `products` → lines whose `productId ∈ scope.ids` → sum line totals.
- If `scope.kind !== 'all'` and `eligibleSubtotal === 0`, throw
  `Error('This code applies to select items that aren\'t in your cart.')` with
  `statusCode = 400`.
- `amount = discount.discountType === 'percentage'
    ? eligibleSubtotal * discount.discountValue / 100
    : Math.min(discount.discountValue, eligibleSubtotal)`.
- Round to cents (`Math.round(amount * 100) / 100`) so PayPal charge and Shopify
  order agree to the penny. Amount can never exceed eligible subtotal, so the
  order total cannot go negative.

### 3. Wiring — `routes/checkout.ts`

- `computeTotals`: replace the flat discount block (current lines 53-68) with a
  call to `computeDiscountAmount(discount, cart.items.map(...))`. `cart.items`
  already include `variant.price` and `productId`.
- `validate-coupon`: extend the cart query to include `productId` and
  `quantity` per item, then call `computeDiscountAmount`. On the thrown
  "not in your cart" error, return its `statusCode`/message. On success, return
  the existing fields plus the computed `discountAmount` (so the app can show
  the real savings).
- Errors thrown by `computeDiscountAmount` carry `statusCode`, consumed by the
  existing `catch` blocks that already read `err.statusCode`.

### 4. Shopify order — `services/shopify-order.ts`

- `createShopifyOrder` already receives `discount: ValidatedDiscount` and
  `appliedDiscountAmount: number`.
- Branch: when `discount.scope.kind !== 'all'` **or**
  `discount.discountType === 'fixed'`, emit `itemFixedDiscountCode` with
  `appliedDiscountAmount` (exact computed value). When
  `scope.kind === 'all' && discountType === 'percentage'`, keep the existing
  `itemPercentageDiscountCode` path — behavior and math are unchanged for
  whole-order codes.
- Applies to both order-creation call sites (PayPal path and the second path),
  since both pass the same `discount` + `appliedDiscountAmount`.

### 5. Testing

Extend existing Jest suites; all 22 current tests must stay green.

- `shopifyDiscount.test.ts`: add fixtures for a `DiscountCollections` and a
  `DiscountProducts` response; assert `scope` is parsed with numeric IDs, and
  that pagination merges multi-page scope lists.
- New `discountApply.test.ts` (or extend `checkoutDiscount.test.ts`): with a
  mocked `prisma.collectionProduct`, assert:
  - eligible-only math for percentage and fixed;
  - fixed code capped at eligible subtotal;
  - empty-eligible scoped code throws 400 with the clear message;
  - `all` scope unchanged (full subtotal).
- `shopifyOrderDiscount.test.ts`: assert scoped discounts emit
  `itemFixedDiscountCode` with the applied amount, and whole-order percentage
  codes still emit `itemPercentageDiscountCode`.

## Rollout

Code change only (no schema/migration; `CollectionProduct` already exists).
Deploy the rebuilt `dist` to `~/trionzabackend` and restart pm2. The separate
Shopify Admin API token fix (24h expiry + self-heal on 401) is being deployed
independently; this feature does not depend on it beyond a working token.

## Open risks

- A discount scoped to a collection that hasn't been synced locally would find
  no eligible products and reject the code. Mitigated by the scheduled sync
  (runs on startup + schedule); acceptable given collections rarely change.
- Variant-level product discounts are matched at the product level (any variant
  of an in-scope product counts). This over-matches only if a code targets some
  variants of a product but not others — rare for this store; documented as a
  known simplification.
