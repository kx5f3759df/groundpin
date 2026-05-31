// ============================================================
// GroundPin — Device Store (AsyncStorage)
// ============================================================
//
// Manages device identity lifecycle:
//   1. Read current appScopedDeviceId (from native module)
//   2. Compare with lastSeenDeviceId
//   3. Trigger key rotation on mismatch
//   4. Store and retrieve DeviceRecord
// ============================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DeviceRecord } from '../types';

const DEVICE_ID_KEY = '@GroundPin:lastSeenDeviceId';
const DEVICE_RECORD_KEY = '@GroundPin:deviceRecord';

/** Save the last-seen device ID for change detection */
export async function saveLastSeenDeviceId(
  appScopedDeviceId: string,
): Promise<void> {
  await AsyncStorage.setItem(DEVICE_ID_KEY, appScopedDeviceId);
}

/** Load the last-seen device ID */
export async function loadLastSeenDeviceId(): Promise<string | null> {
  return AsyncStorage.getItem(DEVICE_ID_KEY);
}

/** Save the device record (key info) */
export async function saveDeviceRecord(
  record: DeviceRecord,
): Promise<void> {
  await AsyncStorage.setItem(DEVICE_RECORD_KEY, JSON.stringify(record));
}

/** Load the device record */
export async function loadDeviceRecord(): Promise<DeviceRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(DEVICE_RECORD_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as DeviceRecord;
  } catch {
    return null;
  }
}

/** Check if device ID has changed and clear stored data if so */
export async function checkDeviceIdChange(
  currentAppScopedDeviceId: string,
): Promise<{ changed: boolean; previousId: string | null }> {
  const previousId = await loadLastSeenDeviceId();

  if (previousId === null) {
    // First launch — save and return
    await saveLastSeenDeviceId(currentAppScopedDeviceId);
    return { changed: false, previousId: null };
  }

  if (previousId !== currentAppScopedDeviceId) {
    // Device ID changed — clear key record
    await AsyncStorage.removeItem(DEVICE_RECORD_KEY);
    await saveLastSeenDeviceId(currentAppScopedDeviceId);
    return { changed: true, previousId };
  }

  return { changed: false, previousId };
}
