// ============================================================
// GroundPin — Native Location Bridge
// ============================================================
//
// TypeScript wrapper around the native location module.
// iOS: CoreLocation (Swift)
// Android: LocationManager (Kotlin, GPS_PROVIDER only)
// ============================================================

import { NativeModules, Platform } from 'react-native';
import type {
  NativeLocationModule,
  LocationFix,
} from '../types';

const Module = NativeModules.GroundPinLocation as NativeLocationModule | undefined;

function ensureModule(): NativeLocationModule {
  if (!Module) {
    throw new Error(
      'GroundPinLocation native module is not available. ' +
      'Ensure the native module is linked correctly.',
    );
  }
  return Module;
}

/**
 * Request when-in-use location permission.
 * Returns true if permission was granted.
 */
export async function requestLocationPermission(): Promise<boolean> {
  return ensureModule().requestLocationPermission();
}

/**
 * Start requesting location updates at the given interval (milliseconds).
 * The native module will deliver updates via event emitter.
 */
export async function startLocationUpdates(
  intervalMs: number,
): Promise<void> {
  return ensureModule().startLocationUpdates({ intervalMs });
}

/**
 * Stop all location updates.
 */
export async function stopLocationUpdates(): Promise<void> {
  return ensureModule().stopLocationUpdates();
}

/**
 * Get a one-shot location snapshot.
 * Returns null if no location is available.
 * The fix is already validated by the native layer, but we re-validate
 * to ensure consistency with our validation rules.
 */
export async function getCurrentLocationSnapshot(): Promise<LocationFix | null> {
  const fix = await ensureModule().getCurrentLocationSnapshot();
  if (!fix) {
    return null;
  }

  return {
    ...fix,
    id: fix.id ?? `fix_${fix.locationTimestampUnixMs}`,
    isValid: fix.isValid ?? false,
    invalidReasons: fix.invalidReasons ?? [],
    riskFlags: fix.riskFlags ?? [],
  };
}

/**
 * Get the current monotonic timestamp in milliseconds.
 * iOS: ProcessInfo.processInfo.systemUptime * 1000
 * Android: SystemClock.elapsedRealtime()
 */
export async function getCurrentMonotonicMs(): Promise<number> {
  return ensureModule().getCurrentMonotonicMs();
}

/**
 * Get the platform name for location source tracking.
 */
export function getPlatform(): 'ios' | 'android' {
  return Platform.OS === 'ios' ? 'ios' : 'android';
}
