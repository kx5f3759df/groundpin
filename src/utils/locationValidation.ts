// ============================================================
// GroundPin — Location Validation
// ============================================================
//
// Validates GNSS LocationFix objects according to MVP rules.
//
// Generic rules for both platforms:
//   1. Permission granted (caller responsibility)
//   2. Lat/Lon present
//   3. horizontalAccuracyMeters > 0
//   4. horizontalAccuracyMeters <= 100
//   5. Location time exists
//   6. accuracyAuthorization == 'precise'
//   7. Age <= 30 seconds
//   8. No impossible speed jumps (> 80 m/s)
//   9. If accuracy >= 15m: at least one accuracy change among last 5 samples
//      (guards against Android mixed/cached fixes reporting stale ~30m)
//
// Platform-specific:
//   iOS:     simulatedBySoftware → invalid; producedByAccessory → risk only
//   Android: provider != 'gps' → invalid; isMock → invalid
// ============================================================

import type { LocationFix } from '../types';
import {
  LOCATION_MAX_ACCURACY_METERS,
  LOCATION_FAST_PATH_ACCURACY_METERS,
  LOCATION_MAX_AGE_MS,
  MAX_REASONABLE_SPEED_MPS,
  LOCATION_HISTORY_SIZE,
} from '../types';

// ---- Single Fix Validation ----

export function validateLocationFix(fix: LocationFix): LocationFix {
  const invalidReasons: string[] = [];
  const riskFlags: string[] = [];

  // Generic checks
  if (fix.latitude == null || fix.longitude == null) {
    invalidReasons.push('missing_coordinates');
  }

  if (
    fix.horizontalAccuracyMeters <= 0 ||
    isNaN(fix.horizontalAccuracyMeters)
  ) {
    invalidReasons.push('invalid_accuracy');
  }

  if (fix.horizontalAccuracyMeters > LOCATION_MAX_ACCURACY_METERS) {
    invalidReasons.push('accuracy_too_low');
  }

  if (
    fix.locationTimestampUnixMs == null ||
    fix.locationTimestampUnixMs <= 0
  ) {
    invalidReasons.push('missing_timestamp');
  }

  if (fix.accuracyAuthorization !== 'precise') {
    invalidReasons.push('not_precise_location');
  }

  if (fix.ageMsAtReceive > LOCATION_MAX_AGE_MS) {
    invalidReasons.push('location_too_old');
  }

  // Platform-specific
  if (fix.source.platform === 'ios') {
    if (fix.source.iosSimulatedBySoftware) {
      invalidReasons.push('simulated_location');
    }
    if (fix.source.iosProducedByAccessory) {
      riskFlags.push('produced_by_accessory');
    }
  }

  if (fix.source.platform === 'android') {
    if (fix.source.androidIsMock) {
      invalidReasons.push('mock_location');
    }
    if (fix.source.provider !== 'gps') {
      invalidReasons.push('non_gps_provider');
    }
  }

  const isValid = invalidReasons.length === 0;

  return {
    ...fix,
    isValid,
    invalidReasons,
    riskFlags,
  };
}

// ---- Speed Jump Detection ----

function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6_371_000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/** Detect impossible speed jumps across recent fixes.
 *  Invalidates the current fix if speed > MAX_REASONABLE_SPEED_MPS.
 *  Caller should provide at most LOCATION_HISTORY_SIZE recent VALID fixes
 *  (chronological order, oldest first), plus the new candidate. */
export function detectSpeedJump(
  recentFixes: Array<{ latitude: number; longitude: number; locationTimestampUnixMs: number }>,
  newFix: { latitude: number; longitude: number; locationTimestampUnixMs: number },
): { hasSpeedJump: boolean; speedMps: number } {
  if (recentFixes.length === 0) {
    return { hasSpeedJump: false, speedMps: 0 };
  }

  const lastFix = recentFixes[recentFixes.length - 1];
  const distance = haversineDistanceMeters(
    lastFix.latitude,
    lastFix.longitude,
    newFix.latitude,
    newFix.longitude,
  );
  const timeDeltaSec = (newFix.locationTimestampUnixMs - lastFix.locationTimestampUnixMs) / 1000;

  if (timeDeltaSec <= 0) {
    return { hasSpeedJump: false, speedMps: 0 };
  }

  const speedMps = distance / timeDeltaSec;
  return {
    hasSpeedJump: speedMps > MAX_REASONABLE_SPEED_MPS,
    speedMps,
  };
}

/** True when at least two samples in the window report different accuracy. */
export function hasAccuracyVariation(
  recentFixes: LocationFix[],
  currentFix: LocationFix,
): boolean {
  const window = [
    ...recentFixes.slice(-(LOCATION_HISTORY_SIZE - 1)),
    currentFix,
  ];
  if (window.length < 2) {
    return false;
  }

  const accuracies = window.map(f => f.horizontalAccuracyMeters);
  return accuracies.some((accuracy, index) =>
    index > 0 && accuracy !== accuracies[index - 1],
  );
}

/** Validate a new fix against recent history, adding stagnation + speed-jump checks */
export function validateWithHistory(
  fix: LocationFix,
  recentFixes: LocationFix[],
): LocationFix {
  const validated = validateLocationFix(fix);

  if (!validated.isValid) {
    return validated;
  }

  if (
    validated.horizontalAccuracyMeters >= LOCATION_FAST_PATH_ACCURACY_METERS &&
    !hasAccuracyVariation(recentFixes, fix)
  ) {
    return {
      ...validated,
      isValid: false,
      invalidReasons: [...validated.invalidReasons, 'stagnant_accuracy'],
      riskFlags: [...validated.riskFlags, 'stagnant_accuracy'],
    };
  }

  // Take the last N fixes from the history for speed-jump check
  const recentSlice = recentFixes
    .filter(f => f.isValid)
    .slice(-LOCATION_HISTORY_SIZE);

  const { hasSpeedJump } = detectSpeedJump(
    recentSlice.map(f => ({
      latitude: f.latitude,
      longitude: f.longitude,
      locationTimestampUnixMs: f.locationTimestampUnixMs,
    })),
    {
      latitude: fix.latitude,
      longitude: fix.longitude,
      locationTimestampUnixMs: fix.locationTimestampUnixMs,
    },
  );

  if (hasSpeedJump) {
    return {
      ...validated,
      isValid: false,
      invalidReasons: [...validated.invalidReasons, 'impossible_speed'],
      riskFlags: [...validated.riskFlags, 'impossible_speed'],
    };
  }

  return validated;
}
