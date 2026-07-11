import axios from 'axios';
import crypto from 'crypto';
import { Request } from 'express';
import { env } from '../config/env';

// Meta Conversions API client. Sends server-side ad events to the dataset in
// META_PIXEL_ID. Silent no-op when the pixel id or access token is unset, so
// dev/CI never talk to Meta. Callers fire-and-forget inside setImmediate —
// nothing here may throw past its own boundary.

const ANDROID_PACKAGE = 'com.trionzadiamond';

export function isMetaCapiEnabled(): boolean {
  return env.META_PIXEL_ID !== '' && env.META_CAPI_ACCESS_TOKEN !== '';
}

export function normalizeAndHash(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

// Meta wants phones as digits only (country code included, no +, spaces, or punctuation).
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return digits || null;
}

export interface MetaRequestContext {
  clientIp?: string;
  userAgent?: string;
  platform: 'android' | 'ios';
  attEnabled: boolean;
  appVersion?: string;
}

// Headers are set by the Flutter ApiService; absent headers (older app builds)
// degrade to android + ATT-off, which only lowers match quality, never breaks.
export function extractRequestContext(req: Request): MetaRequestContext {
  const ua = req.headers['user-agent'];
  const version = req.headers['x-app-version'];
  return {
    clientIp: req.ip,
    userAgent: typeof ua === 'string' ? ua : undefined,
    platform: req.headers['x-app-platform'] === 'ios' ? 'ios' : 'android',
    attEnabled: req.headers['x-meta-att'] === '1',
    appVersion: typeof version === 'string' ? version : undefined,
  };
}

export interface MetaCustomerInfo {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
}

function buildUserData(customer: MetaCustomerInfo, ctx: MetaRequestContext): Record<string, unknown> {
  const userData: Record<string, unknown> = {};
  const em = normalizeAndHash(customer.email);
  if (em) userData.em = [em];
  const ph = normalizeAndHash(normalizePhone(customer.phone));
  if (ph) userData.ph = [ph];
  const fn = normalizeAndHash(customer.firstName);
  if (fn) userData.fn = [fn];
  const ln = normalizeAndHash(customer.lastName);
  if (ln) userData.ln = [ln];
  const extId = normalizeAndHash(customer.id);
  if (extId) userData.external_id = [extId];
  if (ctx.clientIp) userData.client_ip_address = ctx.clientIp;
  if (ctx.userAgent) userData.client_user_agent = ctx.userAgent;
  return userData;
}

// Minimal app_data: required for action_source "app". extinfo is a fixed
// 16-slot array; unknown slots stay ''. Slot 0 is the platform marker.
function buildAppData(ctx: MetaRequestContext): Record<string, unknown> {
  const extinfo = new Array<string>(16).fill('');
  extinfo[0] = ctx.platform === 'ios' ? 'i2' : 'a2';
  extinfo[1] = ANDROID_PACKAGE;
  extinfo[2] = ctx.appVersion ?? '';
  extinfo[3] = ctx.appVersion ?? '';
  return {
    advertiser_tracking_enabled: ctx.attEnabled ? 1 : 0,
    application_tracking_enabled: 1,
    extinfo,
  };
}

async function sendMetaEvent(event: Record<string, unknown>): Promise<boolean> {
  if (!isMetaCapiEnabled()) return false;
  const body: Record<string, unknown> = { data: [event] };
  if (env.META_TEST_EVENT_CODE) body.test_event_code = env.META_TEST_EVENT_CODE;
  try {
    await axios.post(
      `https://graph.facebook.com/${env.META_GRAPH_API_VERSION}/${env.META_PIXEL_ID}/events`,
      body,
      { params: { access_token: env.META_CAPI_ACCESS_TOKEN }, timeout: 10000 }
    );
    return true;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      console.error(
        `[meta-capi] ${event.event_name} failed status=${err.response?.status}`,
        JSON.stringify(err.response?.data ?? err.message)
      );
    } else {
      console.error(`[meta-capi] ${event.event_name} failed:`, err);
    }
    return false;
  }
}

export async function sendPurchaseEvent(params: {
  orderId: number | string;
  orderNumber: string;
  total: number;
  contentIds: string[];
  numItems: number;
  customer: MetaCustomerInfo;
  ctx: MetaRequestContext;
}): Promise<boolean> {
  return sendMetaEvent({
    event_name: 'Purchase',
    event_time: Math.floor(Date.now() / 1000),
    // event_id makes retries idempotent on Meta's side (same id+name = one event).
    event_id: `purchase_${params.orderId}`,
    action_source: 'app',
    user_data: buildUserData(params.customer, params.ctx),
    app_data: buildAppData(params.ctx),
    custom_data: {
      currency: 'USD',
      value: Number(params.total.toFixed(2)),
      content_type: 'product',
      content_ids: params.contentIds,
      num_items: params.numItems,
      order_id: params.orderNumber,
    },
  });
}

export async function sendCompleteRegistrationEvent(params: {
  customer: MetaCustomerInfo;
  ctx: MetaRequestContext;
}): Promise<boolean> {
  return sendMetaEvent({
    event_name: 'CompleteRegistration',
    event_time: Math.floor(Date.now() / 1000),
    event_id: `registration_${params.customer.id}`,
    action_source: 'app',
    user_data: buildUserData(params.customer, params.ctx),
    app_data: buildAppData(params.ctx),
    custom_data: { status: 'completed' },
  });
}
