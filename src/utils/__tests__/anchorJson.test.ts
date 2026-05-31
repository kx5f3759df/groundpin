import { buildAnchorJson, serializeAnchorJson } from '../anchorJson';
import type { AttachmentRecord, LocationFix, EvidenceClock, EvidenceTime } from '../../types';

function makeAttachment(): AttachmentRecord {
  return {
    id: 'att-1',
    type: 'text',
    filename: 'text_1710000000000_ab12.txt',
    anchorFilename: 'text_1710000000000_ab12.json',
    pathInZip: 'attachments/text_1710000000000_ab12.txt',
    anchorPathInZip: 'attachments/text_1710000000000_ab12.json',
    uri: 'file:///text.txt',
    anchorJsonUri: 'file:///text.json',
    mimeType: 'text/plain',
    sizeBytes: 12,
    anchorJsonSizeBytes: 34,
    evidenceTimeUnixMs: 1_710_000_002_000,
    sourceLocationFixId: 'fix-1',
  };
}

function makeFix(): LocationFix {
  return {
    id: 'fix-1',
    latitude: 43.0,
    longitude: -79.0,
    horizontalAccuracyMeters: 12,
    locationTimestampUnixMs: 1_710_000_000_000,
    monotonicTimestampMs: 100_000,
    source: { platform: 'android', provider: 'gps', androidIsMock: false },
    accuracyAuthorization: 'precise',
    ageMsAtReceive: 0,
    isValid: true,
    invalidReasons: [],
    riskFlags: [],
  };
}

describe('anchorJson', () => {
  it('builds anchor JSON with matching attachment id and time derivation', () => {
    const attachment = makeAttachment();
    const fix = makeFix();
    const clock: EvidenceClock = {
      anchorLocationFixId: 'fix-1',
      anchorLocationTimestampUnixMs: 1_710_000_000_000,
      anchorMonotonicMs: 100_000,
    };
    const evidenceTime: EvidenceTime = {
      evidenceTimeUnixMs: 1_710_000_002_000,
      anchorLocationFixId: 'fix-1',
      anchorLocationTimestampUnixMs: 1_710_000_000_000,
      deltaFromAnchorMs: 2_000,
    };

    const anchor = buildAnchorJson(attachment, fix, clock, evidenceTime);
    expect(anchor.attachmentId).toBe('att-1');
    expect(anchor.attachmentFile).toBe(attachment.pathInZip);
    expect(anchor.timeDerivation.derivedEvidenceTimeUnixMs).toBe(1_710_000_002_000);

    const serialized = serializeAnchorJson(anchor);
    expect(JSON.parse(serialized)).toEqual(anchor);
  });
});
