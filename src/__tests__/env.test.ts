describe('env config', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('exports required env vars without throwing', () => {
    expect(() => require('../config/env')).not.toThrow();
  });

  it('has PORT as a number', () => {
    const { env } = require('../config/env');
    expect(typeof env.PORT).toBe('number');
  });

  it('has DATABASE_URL as a string starting with postgresql://', () => {
    const { env } = require('../config/env');
    expect(typeof env.DATABASE_URL).toBe('string');
    expect(env.DATABASE_URL.startsWith('postgresql://')).toBe(true);
  });

  it('defaults Meta CAPI vars to disabled', () => {
    const { env } = require('../config/env');
    expect(env.META_PIXEL_ID).toBe('');
    expect(env.META_CAPI_ACCESS_TOKEN).toBe('');
    expect(env.META_GRAPH_API_VERSION).toBe('v23.0');
    expect(env.META_TEST_EVENT_CODE).toBe('');
  });
});
