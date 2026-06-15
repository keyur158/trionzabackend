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
});
