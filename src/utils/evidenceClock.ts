// ============================================================
// GroundPin — Evidence Clock
// ============================================================
//
// Device wall clock is untrusted. Attachment times are derived from:
//   evidenceTime = anchorLocationTime + monotonicDelta
//
// Platform monotonic sources:
//   iOS:     ProcessInfo.processInfo.systemUptime * 1000
//   Android: SystemClock.elapsedRealtime()
// ============================================================

import type {
  EvidenceClock,
  EvidenceTime,
  LocationFix,
} from '../types';

/** Create an EvidenceClock anchored to a valid LocationFix and a monotonic reading */
export function createEvidenceClock(
  locationFix: LocationFix,
  monotonicMs: number,
): EvidenceClock {
  return {
    anchorLocationFixId: locationFix.id,
    anchorLocationTimestampUnixMs: locationFix.locationTimestampUnixMs,
    anchorMonotonicMs: monotonicMs,
  };
}

/** Derive the current evidence time from a clock anchor and current monotonic reading */
export function getEvidenceTime(
  clock: EvidenceClock,
  currentMonotonicMs: number,
): EvidenceTime {
  const deltaFromAnchorMs = currentMonotonicMs - clock.anchorMonotonicMs;

  return {
    evidenceTimeUnixMs:
      clock.anchorLocationTimestampUnixMs + deltaFromAnchorMs,
    anchorLocationFixId: clock.anchorLocationFixId,
    anchorLocationTimestampUnixMs: clock.anchorLocationTimestampUnixMs,
    deltaFromAnchorMs,
  };
}

/** Check if the evidence clock anchor is still within the attachment window */
export function isClockWithinWindow(
  clock: EvidenceClock,
  currentMonotonicMs: number,
  windowMs: number,
): boolean {
  const delta = currentMonotonicMs - clock.anchorMonotonicMs;
  return delta >= 0 && delta <= windowMs;
}
