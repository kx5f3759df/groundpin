// ============================================================
// GroundPin — Core Type Definitions
// ============================================================

// ---- Platform ----

export type PlatformName = 'ios' | 'android';

// ---- Location ----

export type AccuracyAuthorization = 'precise' | 'approximate' | 'unknown';

export type LocationProvider = 'gps' | 'network' | 'passive' | 'fused' | 'unknown';

export type LocationSource = {
  platform: PlatformName;
  provider: LocationProvider;
  iosSimulatedBySoftware?: boolean;
  iosProducedByAccessory?: boolean;
  androidIsMock?: boolean;
};

export type LocationFix = {
  id: string;
  latitude: number;
  longitude: number;
  horizontalAccuracyMeters: number;
  locationTimestampUnixMs: number;
  monotonicTimestampMs: number;
  source: LocationSource;
  accuracyAuthorization: AccuracyAuthorization;
  ageMsAtReceive: number;
  isValid: boolean;
  invalidReasons: string[];
  riskFlags: string[];
};

// ---- Evidence Clock ----

export type EvidenceClock = {
  anchorLocationFixId: string;
  anchorLocationTimestampUnixMs: number;
  anchorMonotonicMs: number;
};

export type EvidenceTime = {
  evidenceTimeUnixMs: number;
  anchorLocationFixId: string;
  anchorLocationTimestampUnixMs: number;
  deltaFromAnchorMs: number;
};

// ---- Button State ----

export type ButtonState = 'red_invalid' | 'yellow_attachment_only' | 'green_check_in';

// ---- Device ----

export type DeviceRecord = {
  schemaVersion: 1;
  platform: PlatformName;
  appScopedDeviceId: string;
  keyUserId: string;
  keyAlgorithm: string;
  publicKeyFingerprint: string;
  publicKeyFile: 'public_key.asc';
};

// ---- Attachment ----

export type AttachmentType = 'text' | 'audio' | 'photo' | 'video';

export type AttachmentRecord = {
  id: string;
  type: AttachmentType;
  filename: string;
  anchorFilename: string;
  pathInZip: string;
  anchorPathInZip: string;
  uri: string;
  anchorJsonUri: string;
  mimeType: string;
  sizeBytes: number;
  anchorJsonSizeBytes: number;
  evidenceTimeUnixMs: number;
  sourceLocationFixId: string;
};

// ---- Evidence Package ----

export type LocationEvidence = {
  latitude: number;
  longitude: number;
  horizontalAccuracyMeters: number;
  locationTimestampUnixMs: number;
  locationSource: LocationSource;
  accuracyAuthorization: AccuracyAuthorization;
};

export type AnchorJson = {
  schemaVersion: 1;
  attachmentId: string;
  attachmentFile: string;
  anchorFile: string;
  evidenceTimeUnixMs: number;
  sourceLocationFixId: string;
  anchorLocation: LocationEvidence;
  anchorValidation: {
    isValidAtAnchorTime: boolean;
    invalidReasons: string[];
    riskFlags: string[];
  };
  timeDerivation: {
    anchorLocationTimestampUnixMs: number;
    anchorMonotonicMs: number;
    attachmentMonotonicMs: number;
    deltaFromAnchorMs: number;
    derivedEvidenceTimeUnixMs: number;
  };
};

export type ManifestAttachment = {
  id: string;
  type: AttachmentType;
  file: string;
  anchorFile: string;
  mimeType: string;
  evidenceTimeUnixMs: number;
  sourceLocationFixId: string;
};

export type Manifest = {
  schemaVersion: 1;
  packageId: string;
  createdAtEvidenceTimeUnixMs: number;
  platform: PlatformName;
  appVersion: string;
  device: {
    appScopedDeviceId: string;
    keyUserId: string;
    publicKeyFingerprint: string;
    keyAlgorithm: string;
  };
  finalCheckInLocation: {
    file: string;
  };
  hashes: {
    file: string;
    signature: string;
    publicKey: string;
  };
  attachments: ManifestAttachment[];
};

export type LocationJson = {
  schemaVersion: 1;
  selectedFix: {
    id: string;
    latitude: number;
    longitude: number;
    horizontalAccuracyMeters: number;
    locationTimestampUnixMs: number;
    monotonicTimestampMs: number;
    locationSource: LocationSource;
    accuracyAuthorization: AccuracyAuthorization;
    isValid: boolean;
    invalidReasons: string[];
    riskFlags: string[];
  };
  recentFixes: Array<{
    id: string;
    latitude: number;
    longitude: number;
    horizontalAccuracyMeters: number;
    locationTimestampUnixMs: number;
  }>;
  validation: {
    isValid: boolean;
    rulesetVersion: 1;
    maxAccuracyMeters: number;
    maxAgeMs: number;
    maxReasonableSpeedMps: number;
  };
};

// ---- Native Module Interfaces ----

export interface NativeLocationModule {
  requestLocationPermission(): Promise<boolean>;
  startLocationUpdates(input: { intervalMs: number }): Promise<void>;
  stopLocationUpdates(): Promise<void>;
  getCurrentLocationSnapshot(): Promise<LocationFix | null>;
  getCurrentMonotonicMs(): Promise<number>;
}

export interface NativeDeviceKeyModule {
  initializeOrRotateDeviceKey(): Promise<DeviceRecord>;
  exportPublicKeyAsc(): Promise<string>;
  signHashesTxtDetachedGpg(input: {
    hashesTxtUtf8: string;
    armor: boolean;
  }): Promise<{
    signatureUri: string;
    signatureFileName: 'sig.gpg';
    isArmored: boolean;
  }>;
}

export interface NativeMediaModule {
  startRecordAudioM4a(input: {
    evidenceTimeUnixMs: number;
    sourceLocationFixId: string;
  }): Promise<void>;

  stopRecordAudioM4a(): Promise<AttachmentRecord>;

  capturePhotoJpg(input: {
    evidenceTimeUnixMs: number;
    sourceLocationFixId: string;
  }): Promise<AttachmentRecord>;

  captureVideoMp4(input: {
    evidenceTimeUnixMs: number;
    sourceLocationFixId: string;
  }): Promise<AttachmentRecord>;
}

export interface NativePackageModule {
  sha256File(uri: string): Promise<string>;
  writeUtf8File(input: {
    filename: string;
    utf8Content: string;
  }): Promise<{ uri: string; sizeBytes: number }>;
  createZipPackage(input: {
    packageId: string;
    files: Array<{
      pathInZip: string;
      uri: string;
    }>;
  }): Promise<{
    zipUri: string;
    sizeBytes: number;
  }>;
  shareFile(input: {
    uri: string;
    mimeType: string;
    title: string;
  }): Promise<void>;
}

// ---- Constants ----

export const LOCATION_REFRESH_INTERVAL_MS = 1_000;
export const LOCATION_MAX_ACCURACY_METERS = 100;
export const LOCATION_MAX_AGE_MS = 30_000;
export const ATTACHMENT_WINDOW_MS = 10 * 60 * 1000;
export const MAX_REASONABLE_SPEED_MPS = 80;
export const LOCATION_HISTORY_SIZE = 5;
