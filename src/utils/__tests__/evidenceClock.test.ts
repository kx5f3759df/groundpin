import {
  createEvidenceClock,
  getEvidenceTime,
  isClockWithinWindow,
} from '../evidenceClock';
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
    isValid: true,
    invalidReasons: [],
    riskFlags: [],
    ...overrides,
  };
}

describe('evidenceClock', () => {
  it('derives evidence time from anchor and monotonic delta', () => {
    const clock = createEvidenceClock(makeFix(), 100_000);
    const evidenceTime = getEvidenceTime(clock, 105_000);

    expect(evidenceTime.deltaFromAnchorMs).toBe(5_000);
    expect(evidenceTime.evidenceTimeUnixMs).toBe(1_710_000_005_000);
    expect(evidenceTime.anchorLocationFixId).toBe('fix-1');
  });

  it('accepts clock within attachment window', () => {
    const clock = createEvidenceClock(makeFix(), 100_000);
    expect(isClockWithinWindow(clock, 100_000, 10 * 60 * 1000)).toBe(true);
    expect(isClockWithinWindow(clock, 700_000, 10 * 60 * 1000)).toBe(true);
  });

  it('rejects clock outside attachment window', () => {
    const clock = createEvidenceClock(makeFix(), 100_000);
    expect(isClockWithinWindow(clock, 701_000, 10 * 60 * 1000)).toBe(false);
    expect(isClockWithinWindow(clock, 99_000, 10 * 60 * 1000)).toBe(false);
  });
});
