// ============================================================
// GroundPin — Native Device Key Bridge
// ============================================================
//
// TypeScript wrapper around the native key module.
// iOS: Security framework / Keychain (Swift)
// Android: Android Keystore (Kotlin)
//
// Manages device OpenPGP key lifecycle:
//   - First launch: generate key pair
//   - Device ID unchanged: reuse existing key
//   - Device ID changed: delete old key, generate new key
// ============================================================

import { NativeModules } from 'react-native';
import type {
  NativeDeviceKeyModule,
  DeviceRecord,
} from '../types';

const Module = NativeModules.GroundPinDeviceKey as NativeDeviceKeyModule | undefined;

function ensureModule(): NativeDeviceKeyModule {
  if (!Module) {
    throw new Error(
      'GroundPinDeviceKey native module is not available. ' +
      'Ensure the native module is linked correctly.',
    );
  }
  return Module;
}

/**
 * Initialize or rotate the device key pair.
 * Handles the full lifecycle:
 *   1. Read current device ID
 *   2. Compare with last seen
 *   3. Generate or reuse key
 * Returns the device record with key metadata.
 */
export async function initializeOrRotateDeviceKey(): Promise<DeviceRecord> {
  return ensureModule().initializeOrRotateDeviceKey();
}

/**
 * Export the device public key as ASCII-armored OpenPGP public key block.
 * Format: -----BEGIN PGP PUBLIC KEY BLOCK----- ... -----END PGP PUBLIC KEY BLOCK-----
 */
export async function exportPublicKeyAsc(): Promise<string> {
  return ensureModule().exportPublicKeyAsc();
}

/**
 * Sign hashes.txt UTF-8 content with the device private key,
 * producing an OpenPGP detached signature.
 *
 * @param hashesTxtUtf8 - The full hashes.txt content as UTF-8 bytes
 * @param armor - Whether to ASCII-armor the signature (false = binary)
 * @returns Signature file URI, file name, and armor flag
 */
export async function signHashesTxtDetachedGpg(input: {
  hashesTxtUtf8: string;
  armor: boolean;
}): Promise<{
  signatureUri: string;
  signatureFileName: 'sig.gpg';
  isArmored: boolean;
}> {
  return ensureModule().signHashesTxtDetachedGpg(input);
}
