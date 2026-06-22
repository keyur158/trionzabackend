import { compareVersions } from '../utils/version';

describe('compareVersions', () => {
  it('orders by numeric segments', () => {
    expect(compareVersions('1.2.0', '1.4.0')).toBeLessThan(0);
    expect(compareVersions('1.4.0', '1.2.0')).toBeGreaterThan(0);
    expect(compareVersions('1.4.0', '1.4.0')).toBe(0);
  });
  it('ignores +build suffix and pads missing segments', () => {
    expect(compareVersions('1.4.0+7', '1.4.0')).toBe(0);
    expect(compareVersions('1.4', '1.4.0')).toBe(0);
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
  });
});
