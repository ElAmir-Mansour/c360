import { describe, it, expect } from 'vitest';
import { hexToHslTriplet } from './branding';

describe('hexToHslTriplet', () => {
  it('converts the Clario360 teal to its HSL triplet', () => {
    expect(hexToHslTriplet('#005E5E')).toBe('180 100% 18.4314%');
  });
  it('handles missing # and 3-digit shorthand', () => {
    expect(hexToHslTriplet('1B5E20')).toBe('124.4776 55.3719% 23.7255%');
    expect(hexToHslTriplet('#fff')).toBe('0 0% 100%');
    expect(hexToHslTriplet('#000000')).toBe('0 0% 0%');
  });
  it('returns null for malformed input', () => {
    expect(hexToHslTriplet('')).toBeNull();
    expect(hexToHslTriplet('nope')).toBeNull();
    expect(hexToHslTriplet('#12')).toBeNull();
    // @ts-expect-error runtime guard for non-string
    expect(hexToHslTriplet(null)).toBeNull();
  });
});
