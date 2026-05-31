// ============================================================
// GroundPin — Native Media Bridge
// ============================================================
//
// TypeScript wrapper around the native media module.
// iOS: AVFoundation (Swift)
// Android: MediaRecorder + Camera Intent (Kotlin)
//
// Media capture is done in-app only — no photo library access.
// ============================================================

import { NativeModules } from 'react-native';
import type {
  NativeMediaModule,
  AttachmentRecord,
} from '../types';

const Module = NativeModules.GroundPinMedia as NativeMediaModule | undefined;

function ensureModule(): NativeMediaModule {
  if (!Module) {
    throw new Error(
      'GroundPinMedia native module is not available. ' +
      'Ensure the native module is linked correctly.',
    );
  }
  return Module;
}

/**
 * Record audio in-app using the device microphone.
 * Output: AAC-encoded M4A file.
 * Returns the attachment record with file metadata.
 */
export async function recordAudioM4a(input: {
  evidenceTimeUnixMs: number;
  sourceLocationFixId: string;
}): Promise<AttachmentRecord> {
  return ensureModule().recordAudioM4a(input);
}

/**
 * Capture a photo in-app using the device camera.
 * Output: JPEG image.
 * Returns the attachment record with file metadata.
 * Does NOT access photo library — capture only.
 */
export async function capturePhotoJpg(input: {
  evidenceTimeUnixMs: number;
  sourceLocationFixId: string;
}): Promise<AttachmentRecord> {
  return ensureModule().capturePhotoJpg(input);
}

/**
 * Capture a video in-app using the device camera.
 * Output: MP4 video.
 * Returns the attachment record with file metadata.
 * Does NOT access photo library — capture only.
 */
export async function captureVideoMp4(input: {
  evidenceTimeUnixMs: number;
  sourceLocationFixId: string;
}): Promise<AttachmentRecord> {
  return ensureModule().captureVideoMp4(input);
}
