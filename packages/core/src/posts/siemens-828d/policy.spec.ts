import { describe, expect, it } from 'bun:test';
import { siemens828dPolicy } from './policy';

describe('Siemens 828D policy', () => {
  it('preserves signed zero from trace coordinates', () => {
    expect(siemens828dPolicy.formatNumber(-0)).toBe('-0');
  });
});
