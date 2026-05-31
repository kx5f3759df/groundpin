// ============================================================
// GroundPin — Native Package Bridge
// ============================================================
//
// TypeScript wrapper around the native packaging module.
// iOS: custom ZIP writer + UIActivityViewController (Swift)
// Android: java.util.zip + FileProvider share (Kotlin)
// ============================================================

import { NativeModules } from 'react-native';
import type { NativePackageModule } from '../types';

const Module = NativeModules.GroundPinPackage as NativePackageModule | undefined;

function ensureModule(): NativePackageModule {
  if (!Module) {
    throw new Error(
      'GroundPinPackage native module is not available. ' +
      'Ensure the native module is linked correctly.',
    );
  }
  return Module;
}

/**
 * Compute SHA-256 hash of a file at the given URI.
 * Returns lowercase hex string.
 */
export async function sha256File(uri: string): Promise<string> {
  return ensureModule().sha256File(uri);
}

/**
 * Write a UTF-8 text file to the app's private storage.
 * Returns the file URI and size in bytes.
 */
export async function writeUtf8File(input: {
  filename: string;
  utf8Content: string;
}): Promise<{ uri: string; sizeBytes: number }> {
  return ensureModule().writeUtf8File(input);
}

/**
 * Create a ZIP package from a list of files.
 * Files is an array of { pathInZip, uri } pairs.
 * Returns the zip file URI and size.
 */
export async function createZipPackage(input: {
  packageId: string;
  files: Array<{
    pathInZip: string;
    uri: string;
  }>;
}): Promise<{
  zipUri: string;
  sizeBytes: number;
}> {
  return ensureModule().createZipPackage(input);
}

/**
 * Open the system share sheet for a file.
 */
export async function shareFile(input: {
  uri: string;
  mimeType: string;
  title: string;
}): Promise<void> {
  return ensureModule().shareFile(input);
}
