// ============================================================
// GroundPin — Attachment Anchor JSON Generator
// ============================================================
//
// Every attachment must have a corresponding anchor JSON file
// (same basename, .json extension) containing:
//   - The location quintuple used as the anchor
//   - Validation result at anchor time
//   - Time derivation (EvidenceClock → attachment time)
// ============================================================

import type {
  AnchorJson,
  AttachmentRecord,
  LocationFix,
  EvidenceClock,
  EvidenceTime,
} from '../types';

/** Build an anchor JSON object for a newly created attachment */
export function buildAnchorJson(
  attachment: AttachmentRecord,
  locationFix: LocationFix,
  clock: EvidenceClock,
  evidenceTime: EvidenceTime,
): AnchorJson {
  return {
    schemaVersion: 1,
    attachmentId: attachment.id,
    attachmentFile: attachment.pathInZip,
    anchorFile: attachment.anchorPathInZip,
    evidenceTimeUnixMs: evidenceTime.evidenceTimeUnixMs,
    sourceLocationFixId: locationFix.id,
    anchorLocation: {
      latitude: locationFix.latitude,
      longitude: locationFix.longitude,
      horizontalAccuracyMeters: locationFix.horizontalAccuracyMeters,
      locationTimestampUnixMs: locationFix.locationTimestampUnixMs,
      locationSource: locationFix.source,
      accuracyAuthorization: locationFix.accuracyAuthorization,
    },
    anchorValidation: {
      isValidAtAnchorTime: locationFix.isValid,
      invalidReasons: locationFix.invalidReasons,
      riskFlags: locationFix.riskFlags,
    },
    timeDerivation: {
      anchorLocationTimestampUnixMs: clock.anchorLocationTimestampUnixMs,
      anchorMonotonicMs: clock.anchorMonotonicMs,
      attachmentMonotonicMs:
        clock.anchorMonotonicMs + evidenceTime.deltaFromAnchorMs,
      deltaFromAnchorMs: evidenceTime.deltaFromAnchorMs,
      derivedEvidenceTimeUnixMs: evidenceTime.evidenceTimeUnixMs,
    },
  };
}

/** Serialize an anchor JSON to a formatted string */
export function serializeAnchorJson(anchor: AnchorJson): string {
  return JSON.stringify(anchor, null, 2);
}
