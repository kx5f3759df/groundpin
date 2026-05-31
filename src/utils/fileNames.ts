// ============================================================
// GroundPin — File Name Generator
// ============================================================
//
// Attachment file naming convention:
//   <type>_<evidenceTimeUnixMs>_<shortId>.<ext>
//
// Anchor JSON: same basename, .json extension
// ============================================================

import type { AttachmentType } from '../types';

const EXTENSIONS: Record<AttachmentType, string> = {
  text: 'txt',
  audio: 'm4a',
  photo: 'jpg',
  video: 'mp4',
};

const MIME_TYPES: Record<AttachmentType, string> = {
  text: 'text/plain',
  audio: 'audio/mp4',
  photo: 'image/jpeg',
  video: 'video/mp4',
};

/** Build an attachment filename */
export function buildAttachmentFileName(
  type: AttachmentType,
  evidenceTimeUnixMs: number,
  shortId: string,
): string {
  const ext = EXTENSIONS[type];
  return `${type}_${evidenceTimeUnixMs}_${shortId}.${ext}`;
}

/** Build the corresponding anchor JSON filename */
export function buildAnchorFileName(
  type: AttachmentType,
  evidenceTimeUnixMs: number,
  shortId: string,
): string {
  return `${type}_${evidenceTimeUnixMs}_${shortId}.json`;
}

/** Build path inside zip */
export function buildZipPath(filename: string): string {
  return `attachments/${filename}`;
}

/** Get MIME type for a file extension */
export function getMimeType(type: AttachmentType): string {
  return MIME_TYPES[type];
}

/** Get file extension for an attachment type */
export function getFileExtension(type: AttachmentType): string {
  return EXTENSIONS[type];
}
