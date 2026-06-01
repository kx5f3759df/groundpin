import {
  validateLocationFix,
  validateWithHistory,
  hasAccuracyVariation,
} from '../locationValidation';
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

  it('accepts high-confidence fix without history variation', () => {
    const result = validateWithHistory(makeFix({ horizontalAccuracyMeters: 12 }), []);
    expect(result.isValid).toBe(true);
  });

  it('rejects stagnant accuracy at 30m with unchanged history', () => {
    const history = Array.from({ length: 4 }, (_, index) =>
      validateLocationFix(
        makeFix({
          id: `fix-${index}`,
          horizontalAccuracyMeters: 30,
          locationTimestampUnixMs: 1_710_000_000_000 + index * 1000,
        }),
      ),
    );
    const result = validateWithHistory(
      makeFix({
        id: 'fix-current',
        horizontalAccuracyMeters: 30,
        locationTimestampUnixMs: 1_710_000_004_000,
      }),
      history,
    );

    expect(result.isValid).toBe(false);
    expect(result.invalidReasons).toContain('stagnant_accuracy');
  });

  it('accepts 30m fix when history shows accuracy variation', () => {
    const history = [
      validateLocationFix(makeFix({ id: 'fix-0', horizontalAccuracyMeters: 30 })),
      validateLocationFix(makeFix({ id: 'fix-1', horizontalAccuracyMeters: 29 })),
    ];
    const result = validateWithHistory(
      makeFix({ id: 'fix-current', horizontalAccuracyMeters: 30 }),
      history,
    );

    expect(result.isValid).toBe(true);
  });

  it('rejects exactly 15m with no variation', () => {
    const result = validateWithHistory(
      makeFix({ horizontalAccuracyMeters: 15 }),
      [],
    );

    expect(result.isValid).toBe(false);
    expect(result.invalidReasons).toContain('stagnant_accuracy');
  });

  it('accepts exactly 15m when variation exists', () => {
    const history = [
      validateLocationFix(makeFix({ id: 'fix-0', horizontalAccuracyMeters: 16 })),
    ];
    const result = validateWithHistory(
      makeFix({ id: 'fix-current', horizontalAccuracyMeters: 15 }),
      history,
    );

    expect(result.isValid).toBe(true);
  });

  it('rejects single 20m sample with no prior history', () => {
    const result = validateWithHistory(
      makeFix({ horizontalAccuracyMeters: 20 }),
      [],
    );

    expect(result.isValid).toBe(false);
    expect(result.invalidReasons).toContain('stagnant_accuracy');
  });

  it('detects accuracy variation across a window', () => {
    const history = [
      makeFix({ horizontalAccuracyMeters: 30 }),
      makeFix({ horizontalAccuracyMeters: 30 }),
    ];
    expect(hasAccuracyVariation(history, makeFix({ horizontalAccuracyMeters: 30 }))).toBe(
      false,
    );
    expect(hasAccuracyVariation(history, makeFix({ horizontalAccuracyMeters: 31 }))).toBe(
      true,
    );
  });
});
