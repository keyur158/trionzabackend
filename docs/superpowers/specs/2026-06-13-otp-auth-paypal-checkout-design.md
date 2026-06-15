# Design: OTP Auth (ZeptoMail) + Secure PayPal + Professional Checkout

Date: 2026-06-13
Scope: `server/` (Express + Prisma) and `app/` (Flutter + GetX)

## Goals

1. Replace email/password auth with passwordless 6-digit OTP delivered by ZeptoMail.
2. Replace the test "bypass" checkout with a secure server-side PayPal flow.
3. Redesign the checkout UI to a professional, branded experience.

Out of scope: cart, product, order-history, Shopify sync logic (touched only where auth/checkout require).

---

## 1. OTP Authentication

### Database (`prisma/schema.prisma`)
- New model `OtpCode`:
  - `id` (uuid), `email` (indexed), `codeHash` (String), `purpose` (`login` | `signup`),
    `firstName?`, `lastName?`, `phone?` (stashed signup data), `expiresAt` (DateTime),
    `attempts` (Int @default(0)), `consumedAt?` (DateTime), `createdAt`.
- `Customer.passwordHash` becomes optional (`String?`). Non-destructive; bcrypt logic removed.

### Backend
- New `src/services/email.ts`:
  - `sendOtpEmail(email, code)` → ZeptoMail REST (`POST https://api.zeptomail.com/v1.1/email`,
    header `Authorization: Zoho-enczapikey <token>`), branded burgundy HTML template, via axios.
  - Placeholder-safe: if `ZEPTOMAIL_TOKEN` is empty/placeholder, log the OTP to console instead of sending.
- `src/config/env.ts` + `.env.example`: add `ZEPTOMAIL_TOKEN`, `ZEPTOMAIL_FROM_ADDRESS`, `ZEPTOMAIL_FROM_NAME`
  (all optional with safe defaults so the app boots without real creds).
- `src/routes/auth.ts` rewritten:
  - `POST /api/auth/request-otp` `{ email, purpose, firstName?, lastName?, phone? }`
    - `signup`: 409 if customer exists; stash name/phone with code.
    - `login`: 404 if no local customer AND not found in Shopify by email.
    - Generate 6-digit code, hash + store (10-min expiry), invalidate prior unconsumed codes
      for same email+purpose, enforce 60s resend cooldown, send email.
  - `POST /api/auth/verify-otp` `{ email, code }`
    - Validate code/expiry/attempt-cap (max 5). On success:
      - `signup`: create Customer from stashed data, async Shopify customer create.
      - `login`: load Customer (create local record from Shopify lookup if needed).
    - Returns existing `{ token, customer: { id, email, firstName, lastName } }` shape.
  - `/profile` GET/PUT unchanged.

### Flutter (separate Login & Signup kept)
- `ApiService`: `requestOtp({email, purpose, firstName?, lastName?, phone?})`, `verifyOtp({email, code})`.
  Remove `login`/`signup` password methods.
- `AuthController`: `requestOtp(...)`, `verifyOtp(...)` replacing `login`/`signup`.
- `login_view.dart`: email only → "Send Code" → OTP screen.
- `signup_view.dart`: name + email (+ phone) → "Send Code" → OTP screen. Password fields removed.
- New `otp_verification_view.dart` + controller state: 6-box code input, resend timer (60s),
  verify button. New route `AppRoutes.otp`.

---

## 2. Secure PayPal

### Backend
- `src/services/paypal.ts`: add `createPayPalOrder(amount, currency, returnUrl, cancelUrl)`
  → `{ id, approveUrl }` (intent CAPTURE). Existing `capturePayPalPayment` reused.
- `src/routes/checkout.ts`:
  - `POST /api/checkout/create-paypal-order` `{ shippingRateId, couponCode? }`
    → recompute totals server-side, create PayPal order, return `{ paypalOrderId, approveUrl }`.
  - `/create-order` (real capture) unchanged.
  - `/create-order-test` gated to non-production (`NODE_ENV !== 'production'`).

### Flutter
- `ApiService`: `createPaypalOrder({shippingRateId, couponCode?})`.
- `CheckoutController`: `createPaypalOrder()` returns `{paypalOrderId, approveUrl}`; keep `placeOrder(paypalOrderId)`.
  Remove `placeTestOrder` from UI usage.
- Payment step: "Pay with PayPal" → create order → open `approveUrl` in `flutter_inappwebview`
  → on redirect to success URL close webview + `placeOrder(paypalOrderId)` (captures + creates order);
  cancel URL closes cleanly. Success/cancel URLs are fixed sentinels detected by URL prefix.

---

## 3. Professional Checkout UI (`checkout_view.dart`)

- Step progress header (1 Address · 2 Shipping · 3 Review · 4 Payment) with active/completed states (brand burgundy).
- Selectable address & shipping cards: highlighted border + check when selected, price emphasis.
- Order summary card: item thumbnails, clean price breakdown, refined coupon field.
- Sticky bottom bar: Back + primary Continue.
- Payment step: prominent total, branded PayPal button, "Secure payment via PayPal" trust note, loading states.
- All styling via `AppTheme`.

---

## Migration / Rollout
- Run `prisma db push` (or migrate) for `OtpCode` + nullable `passwordHash`.
- `bcryptjs` becomes unused (drop later; left installed for now).
- Real ZeptoMail + PayPal credentials pasted into `.env` when available; until then OTP logs to console
  and PayPal uses sandbox.