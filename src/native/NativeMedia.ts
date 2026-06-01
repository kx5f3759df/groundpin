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

/** Begin in-app microphone recording (tap stop to finish). */
export async function startRecordAudioM4a(input: {
  evidenceTimeUnixMs: number;
  sourceLocationFixId: string;
}): Promise<void> {
  return ensureModule().startRecordAudioM4a(input);
}

/** Stop recording and return the attachment record. */
export async function stopRecordAudioM4a(): Promise<AttachmentRecord> {
  return ensureModule().stopRecordAudioM4a();
}

/**
 * Capture a photo in-app using the device camera.
 * Output: JPEG image.
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
 */
export async function captureVideoMp4(input: {
  evidenceTimeUnixMs: number;
  sourceLocationFixId: string;
}): Promise<AttachmentRecord> {
  return ensureModule().captureVideoMp4(input);
}
