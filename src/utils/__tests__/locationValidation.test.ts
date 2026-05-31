import { validateLocationFix, validateWithHistory } from '../locationValidation';
import type { LocationFix } from '../../types';

function makeFix(overrides: Partial<LocationFix> = {}): LocationFix {
  return {
    id: 'fix-1',
    latitude: 43.0,
    longitude: -79.0,
    horizontalAccuracyMeters: 12,
    locationTimestampUnixMs: 1_710_000_000_000,
    monotonicTimestampMs: 100_000,
    source: { platform: 'android', provider: 'gps', androidIsMock: false },
    accuracyAuthorization: 'precise',
    ageMsAtReceive: 0,
    isValid: false,
    invalidReasons: [],
    riskFlags: [],
    ...overrides,
  };
}

describe('locationValidation', () => {
  it('accepts a valid GPS fix', () => {
    const result = validateLocationFix(makeFix());
    expect(result.isValid).toBe(true);
    expect(result.invalidReasons).toEqual([]);
  });

  it('rejects coarse location', () => {
    const result = validateLocationFix(
      makeFix({ accuracyAuthorization: 'approximate' }),
    );
    expect(result.isValid).toBe(false);
    expect(result.invalidReasons).toContain('not_precise_location');
  });

  it('rejects mock Android location', () => {
    const result = validateLocationFix(
      makeFix({
        source: {
          platform: 'android',
          provider: 'gps',
          androidIsMock: true,
        },
      }),
    );
    expect(result.isValid).toBe(false);
    expect(result.invalidReasons).toContain('mock_location');
  });

  it('rejects impossible speed jumps', () => {
    const previous = validateLocationFix(makeFix());
    const next = validateWithHistory(
      makeFix({
        id: 'fix-2',
        latitude: 44.0,
        locationTimestampUnixMs: 1_710_000_001_000,
      }),
      [previous],
    );

    expect(next.isValid).toBe(false);
    expect(next.invalidReasons).toContain('impossible_speed');
    expect(next.riskFlags).toContain('impossible_speed');
  });
});
