describe('isAdmin wiring', () => {
  beforeEach(() => jest.resetModules());

  it('admin email is admin, others are not', () => {
    process.env.ADMIN_EMAILS = 'admin@trionza.com';
    const { isAdminEmail } = require('../utils/admin');
    expect(isAdminEmail('admin@trionza.com')).toBe(true);
    expect(isAdminEmail('user@trionza.com')).toBe(false);
  });
});