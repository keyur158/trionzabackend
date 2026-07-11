let sharedMockPost = jest.fn();
jest.mock('axios', () => ({
  post: sharedMockPost,
  isAxiosError: (err: unknown) => err instanceof Error && 'response' in err,
}));

import crypto from 'crypto';
import axios from 'axios';

const mockPost = axios.post as jest.Mock;

const BASE_ENV = { ...process.env };

function loadService(envOverrides: Record<string, string>) {
  jest.resetModules();
  process.env = { ...BASE_ENV, ...envOverrides };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../services/meta-capi');
}

const CTX = { clientIp: '1.2.3.4', userAgent: 'Dart/3.4', platform: 'android' as const, attEnabled: true, appVersion: '1.4.0' };
const CUSTOMER = { id: 'cust-1', email: ' A@A.com ', firstName: 'Jo', lastName: 'Doe', phone: '+1 (555) 010-9999' };

afterAll(() => { process.env = BASE_ENV; });

describe('meta-capi hashing', () => {
  it('normalizeAndHash lowercases, trims, and sha256-hashes', () => {
    const { normalizeAndHash } = loadService({});
    const expected = crypto.createHash('sha256').update('a@a.com').digest('hex');
    expect(normalizeAndHash(' A@A.com ')).toBe(expected);
    expect(normalizeAndHash('')).toBeNull();
    expect(normalizeAndHash(null)).toBeNull();
  });

  it('normalizePhone strips everything but digits', () => {
    const { normalizePhone } = loadService({});
    expect(normalizePhone('+1 (555) 010-9999')).toBe('15550109999');
    expect(normalizePhone('abc')).toBeNull();
  });
});

describe('sendPurchaseEvent', () => {
  beforeEach(() => mockPost.mockReset());

  it('no-ops and returns false when CAPI env vars are empty', async () => {
    const svc = loadService({ META_PIXEL_ID: '', META_CAPI_ACCESS_TOKEN: '' });
    const ok = await svc.sendPurchaseEvent({
      orderId: 7, orderNumber: '1001', total: 470, contentIds: ['p1'], numItems: 1,
      customer: CUSTOMER, ctx: CTX,
    });
    expect(ok).toBe(false);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('posts a correctly shaped Purchase event when enabled', async () => {
    mockPost.mockResolvedValue({ data: { events_received: 1 } });
    const svc = loadService({ META_PIXEL_ID: 'PIX123', META_CAPI_ACCESS_TOKEN: 'tok', META_GRAPH_API_VERSION: 'v23.0', META_TEST_EVENT_CODE: '' });
    const ok = await svc.sendPurchaseEvent({
      orderId: 7, orderNumber: '1001', total: 470, contentIds: ['p1', 'p2'], numItems: 3,
      customer: CUSTOMER, ctx: CTX,
    });
    expect(ok).toBe(true);
    expect(mockPost).toHaveBeenCalledTimes(1);
    const [url, body, config] = mockPost.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v23.0/PIX123/events');
    expect(config.params.access_token).toBe('tok');
    expect(body.test_event_code).toBeUndefined();
    const evt = body.data[0];
    expect(evt.event_name).toBe('Purchase');
    expect(evt.event_id).toBe('purchase_7');
    expect(evt.action_source).toBe('app');
    expect(typeof evt.event_time).toBe('number');
    const emailHash = crypto.createHash('sha256').update('a@a.com').digest('hex');
    expect(evt.user_data.em).toEqual([emailHash]);
    expect(evt.user_data.ph).toEqual([crypto.createHash('sha256').update('15550109999').digest('hex')]);
    expect(evt.user_data.external_id).toEqual([crypto.createHash('sha256').update('cust-1').digest('hex')]);
    expect(evt.user_data.client_ip_address).toBe('1.2.3.4');
    expect(evt.user_data.client_user_agent).toBe('Dart/3.4');
    expect(evt.app_data.advertiser_tracking_enabled).toBe(1);
    expect(evt.app_data.extinfo[0]).toBe('a2');
    expect(evt.app_data.extinfo).toHaveLength(16);
    expect(evt.custom_data).toEqual({
      currency: 'USD', value: 470, content_type: 'product',
      content_ids: ['p1', 'p2'], num_items: 3, order_id: '1001',
    });
  });

  it('includes test_event_code when configured', async () => {
    mockPost.mockResolvedValue({ data: {} });
    const svc = loadService({ META_PIXEL_ID: 'PIX123', META_CAPI_ACCESS_TOKEN: 'tok', META_TEST_EVENT_CODE: 'TEST99' });
    await svc.sendPurchaseEvent({ orderId: 1, orderNumber: 'X', total: 1, contentIds: [], numItems: 0, customer: CUSTOMER, ctx: CTX });
    expect(mockPost.mock.calls[0][1].test_event_code).toBe('TEST99');
  });

  it('returns false and never throws when the Graph API call fails', async () => {
    mockPost.mockRejectedValue(new Error('network down'));
    const svc = loadService({ META_PIXEL_ID: 'PIX123', META_CAPI_ACCESS_TOKEN: 'tok' });
    await expect(svc.sendPurchaseEvent({
      orderId: 1, orderNumber: 'X', total: 1, contentIds: [], numItems: 0, customer: CUSTOMER, ctx: CTX,
    })).resolves.toBe(false);
  });
});

describe('sendCompleteRegistrationEvent', () => {
  beforeEach(() => mockPost.mockReset());

  it('posts a CompleteRegistration event keyed to the customer id', async () => {
    mockPost.mockResolvedValue({ data: {} });
    const svc = loadService({ META_PIXEL_ID: 'PIX123', META_CAPI_ACCESS_TOKEN: 'tok' });
    const ok = await svc.sendCompleteRegistrationEvent({ customer: CUSTOMER, ctx: { ...CTX, platform: 'ios', attEnabled: false } });
    expect(ok).toBe(true);
    const evt = mockPost.mock.calls[0][1].data[0];
    expect(evt.event_name).toBe('CompleteRegistration');
    expect(evt.event_id).toBe('registration_cust-1');
    expect(evt.app_data.extinfo[0]).toBe('i2');
    expect(evt.app_data.advertiser_tracking_enabled).toBe(0);
  });
});

describe('extractRequestContext', () => {
  it('reads app headers with safe defaults', () => {
    const { extractRequestContext } = loadService({});
    const req = {
      ip: '9.9.9.9',
      headers: { 'user-agent': 'UA', 'x-app-platform': 'ios', 'x-meta-att': '1', 'x-app-version': '1.4.0' },
    } as never;
    expect(extractRequestContext(req)).toEqual({
      clientIp: '9.9.9.9', userAgent: 'UA', platform: 'ios', attEnabled: true, appVersion: '1.4.0',
    });
    const bare = { ip: undefined, headers: {} } as never;
    expect(extractRequestContext(bare)).toEqual({
      clientIp: undefined, userAgent: undefined, platform: 'android', attEnabled: false, appVersion: undefined,
    });
  });
});
