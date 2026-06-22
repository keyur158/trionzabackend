describe('isAdminEmail', () => {
  beforeEach(() => jest.resetModules());

  it('matches allowlisted emails case-insensitively', () => {
    process.env.ADMIN_EMAILS = 'manthanzlj@gmail.com, boss@trionza.com';
    const { isAdminEmail } = require('../utils/admin');
    expect(isAdminEmail('MANTHANZLJ@gmail.com')).toBe(true);
    expect(isAdminEmail('boss@trionza.com')).toBe(true);
    expect(isAdminEmail('random@user.com')).toBe(false);
    expect(isAdminEmail(null)).toBe(false);
    expect(isAdminEmail(undefined)).toBe(false);
  });
});