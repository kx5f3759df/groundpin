// ============================================================
// GroundPin — MainScreen
// ============================================================
//
// Core UI screen with:
//   - Tri-state circular button (red/yellow/green)
//   - Location status text
//   - Bottom media action bar (text / audio / photo / video)
//   - Top-right attachment count badge
//   - 1-second location polling
//   - EvidenceClock anchor management
//   - Check-in package generation
// ============================================================

import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  TextInput,
  Modal,
  Platform,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type {
  ButtonState,
  LocationFix,
  EvidenceClock,
  EvidenceTime,
  AttachmentRecord,
} from '../types';
import {
  LOCATION_REFRESH_INTERVAL_MS,
  ATTACHMENT_WINDOW_MS,
} from '../types';
import { createLocationLifecycle } from '../utils/appStateLocationController';
import { createEvidenceClock, getEvidenceTime, isClockWithinWindow } from '../utils/evidenceClock';
import { validateWithHistory } from '../utils/locationValidation';
import { shortId, generateId } from '../utils/ids';
import * as FileNames from '../utils/fileNames';
import { buildAnchorJson, serializeAnchorJson } from '../utils/anchorJson';
import { buildHashesTxt } from '../utils/hashesTxt';
import * as AttachmentStore from '../storage/attachmentStore';
import * as DeviceStore from '../storage/deviceStore';
import * as NativeLocation from '../native/NativeLocation';
import * as NativeDeviceKey from '../native/NativeDeviceKey';
import * as NativeMedia from '../native/NativeMedia';
import * as NativePackage from '../native/NativePackage';

type RootStackParamList = {
  Main: undefined;
  Attachments: undefined;
};

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Main'>;
};

export default function MainScreen({ navigation }: Props) {
  // ---- State ----
  const [buttonState, setButtonState] = useState<ButtonState>('red_invalid');
  const [statusText, setStatusText] = useState('等待有效 GNSS 定位');
  const [attachmentCount, setAttachmentCount] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [textModalVisible, setTextModalVisible] = useState(false);
  const [textInputValue, setTextInputValue] = useState('');

  // Non-rendering mutable refs
  const anchorClockRef = useRef<EvidenceClock | null>(null);
  const recentFixesRef = useRef<LocationFix[]>([]);
  const lifecycleRef = useRef<ReturnType<typeof createLocationLifecycle> | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentFixRef = useRef<LocationFix | null>(null);

  // ---- Button State Calculation ----

  const computeButtonState = useCallback(
    (currentFix: LocationFix | null): ButtonState => {
      if (currentFix && currentFix.isValid) {
        // Green: current location is valid
        setStatusText(`定位精度 ${currentFix.horizontalAccuracyMeters.toFixed(0)}m，可以打卡`);
        return 'green_check_in';
      }

      const anchor = anchorClockRef.current;
      // Check if we have a recent valid anchor
      if (anchor) {
        // We need current monotonic time to check window - poll via ref
        // But for immediate state calc, check if anchorClock's monotonic
        // was set within ATTACHMENT_WINDOW_MS (approximate)
        // Accurate check happens in the poll loop
        setStatusText('当前 GNSS 无效，但 10 分钟内有有效定位，只可添加附件');
        return 'yellow_attachment_only';
      }

      // Red: no valid location and no valid anchor
      if (!currentFix) {
        setStatusText('等待有效 GNSS 定位');
      } else if (currentFix.invalidReasons.includes('not_precise_location')) {
        setStatusText('模糊定位，无法打卡');
      } else if (currentFix.invalidReasons.includes('simulated_location')) {
        setStatusText('疑似模拟定位，无法打卡');
      } else if (currentFix.invalidReasons.includes('mock_location')) {
        setStatusText('疑似模拟定位，无法打卡');
      } else if (currentFix.invalidReasons.includes('location_too_old')) {
        setStatusText('定位过旧，无法打卡');
      } else if (currentFix.invalidReasons.includes('non_gps_provider')) {
        setStatusText('非 GPS provider，无法打卡');
      } else if (currentFix.invalidReasons.includes('accuracy_too_low')) {
        setStatusText(`定位精度太差 (${currentFix.horizontalAccuracyMeters.toFixed(0)}m)，无法打卡`);
      } else {
        setStatusText('等待有效 GNSS 定位');
      }
      return 'red_invalid';
    },
    [],
  );

  // ---- Location Polling ----

  const pollLocation = useCallback(async () => {
    try {
      const fix = await NativeLocation.getCurrentLocationSnapshot();
      if (!fix) {
        currentFixRef.current = null;
        setButtonState(computeButtonState(null));
        return;
      }

      // Validate with history
      const validated = validateWithHistory(fix, recentFixesRef.current);
      currentFixRef.current = validated;

      // Update recent fixes
      recentFixesRef.current.push(validated);
      if (recentFixesRef.current.length > 5) {
        recentFixesRef.current = recentFixesRef.current.slice(-5);
      }

      // If valid, set as anchor
      if (validated.isValid) {
        try {
          const monotonicMs = await NativeLocation.getCurrentMonotonicMs();
          anchorClockRef.current = createEvidenceClock(validated, monotonicMs);
        } catch {
          // Ignore monotonic errors
        }
      }

      // Recalculate button state
      const state = computeButtonState(validated);

      // If yellow but anchor is too old, revert to red
      if (state === 'yellow_attachment_only' && anchorClockRef.current) {
        try {
          const monotonicMs = await NativeLocation.getCurrentMonotonicMs();
          if (!isClockWithinWindow(anchorClockRef.current, monotonicMs, ATTACHMENT_WINDOW_MS)) {
            anchorClockRef.current = null;
            setButtonState('red_invalid');
            setStatusText('最近有效定位已超过 10 分钟，等待新定位');
            return;
          }
        } catch {
          // If we can't get monotonic, keep yellow as best guess
        }
      }

      setButtonState(state);
    } catch {
      // Location query failed — stay at current state
    }
  }, [computeButtonState]);

  // ---- Lifecycle ----

  useEffect(() => {
    // Initialize device key on first launch
    NativeDeviceKey.initializeOrRotateDeviceKey().catch(() => {
      // Will surface error in UI if needed
    });

    // Load attachment count
    AttachmentStore.getAttachmentCount().then(setAttachmentCount);

    // Start location lifecycle
    const lifecycle = createLocationLifecycle({
      onStart: async () => {
        try {
          await NativeLocation.requestLocationPermission();
          await NativeLocation.startLocationUpdates(LOCATION_REFRESH_INTERVAL_MS);
          // Poll immediately
          pollLocation();
          // Then every second
          pollTimerRef.current = setInterval(pollLocation, LOCATION_REFRESH_INTERVAL_MS);
        } catch {
          // Permission denied or module error
          setStatusText('定位权限未授权');
        }
      },
      onStop: async () => {
        if (pollTimerRef.current) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
        try {
          await NativeLocation.stopLocationUpdates();
        } catch {
          // Best effort
        }
        anchorClockRef.current = null;
        recentFixesRef.current = [];
        currentFixRef.current = null;
        setButtonState('red_invalid');
        setStatusText('等待有效 GNSS 定位');
      },
    });

    lifecycleRef.current = lifecycle;
    lifecycle.activate();

    // Focus listener for attachment count
    const unsubscribe = navigation.addListener('focus', () => {
      AttachmentStore.getAttachmentCount().then(setAttachmentCount);
    });

    return () => {
      unsubscribe();
      lifecycle.destroy();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Package Generation ----

  const generatePackage = useCallback(async () => {
    const currentFix = currentFixRef.current;
    if (!currentFix || !currentFix.isValid) {
      throw new Error('当前定位无效，无法生成打卡包');
    }

    const clock = anchorClockRef.current;
    if (!clock) {
      throw new Error('没有有效的时间锚点');
    }

    // Get device record
    let deviceRecord = await DeviceStore.loadDeviceRecord();
    if (!deviceRecord) {
      deviceRecord = await NativeDeviceKey.initializeOrRotateDeviceKey();
    }

    // Get current monotonic for evidence time
    const monotonicMs = await NativeLocation.getCurrentMonotonicMs();
    const evidenceTime = getEvidenceTime(clock, monotonicMs);
    const packageId = generateId();

    const platform = NativeLocation.getPlatform();
    const appVersion = '1.0.0';

    // Load all attachments
    const attachments = await AttachmentStore.loadAttachments();

    // Build the file list for the package
    const files: Array<{ pathInZip: string; uri: string }> = [];
    const hashes: Array<{ pathInZip: string; sha256Hex: string }> = [];

    // Compute SHA-256 for all attachment files and their anchor JSONs
    for (const att of attachments) {
      if (att.uri) {
        const hash = await NativePackage.sha256File(att.uri);
        hashes.push({ pathInZip: att.pathInZip, sha256Hex: hash });
        files.push({ pathInZip: att.pathInZip, uri: att.uri });
      }
      if (att.anchorJsonUri) {
        const hash = await NativePackage.sha256File(att.anchorJsonUri);
        hashes.push({ pathInZip: att.anchorPathInZip, sha256Hex: hash });
        files.push({ pathInZip: att.anchorPathInZip, uri: att.anchorJsonUri });
      }
    }

    // Build manifest.json
    const manifest = {
      schemaVersion: 1 as const,
      packageId,
      createdAtEvidenceTimeUnixMs: evidenceTime.evidenceTimeUnixMs,
      platform,
      appVersion,
      device: {
        appScopedDeviceId: deviceRecord.appScopedDeviceId,
        keyUserId: deviceRecord.keyUserId,
        publicKeyFingerprint: deviceRecord.publicKeyFingerprint,
        keyAlgorithm: deviceRecord.keyAlgorithm,
      },
      finalCheckInLocation: { file: 'location.json' },
      hashes: {
        file: 'hashes.txt',
        signature: 'sig.gpg',
        publicKey: 'public_key.asc',
      },
      attachments: attachments.map((att) => ({
        id: att.id,
        type: att.type,
        file: att.pathInZip,
        anchorFile: att.anchorPathInZip,
        mimeType: att.mimeType,
        evidenceTimeUnixMs: att.evidenceTimeUnixMs,
        sourceLocationFixId: att.sourceLocationFixId,
      })),
    };

    const manifestJson = JSON.stringify(manifest, null, 2);
    const manifestResult = await NativePackage.writeUtf8File({
      filename: 'manifest.json',
      utf8Content: manifestJson,
    });
    files.push({ pathInZip: 'manifest.json', uri: manifestResult.uri });
    const manifestHash = await NativePackage.sha256File(manifestResult.uri);
    hashes.push({ pathInZip: 'manifest.json', sha256Hex: manifestHash });

    // Build location.json
    const locationJson = {
      schemaVersion: 1 as const,
      selectedFix: {
        id: currentFix.id,
        latitude: currentFix.latitude,
        longitude: currentFix.longitude,
        horizontalAccuracyMeters: currentFix.horizontalAccuracyMeters,
        locationTimestampUnixMs: currentFix.locationTimestampUnixMs,
        monotonicTimestampMs: currentFix.monotonicTimestampMs,
        locationSource: currentFix.source,
        accuracyAuthorization: currentFix.accuracyAuthorization,
        isValid: currentFix.isValid,
        invalidReasons: currentFix.invalidReasons,
        riskFlags: currentFix.riskFlags,
      },
      recentFixes: recentFixesRef.current.slice(-5).map((f) => ({
        id: f.id,
        latitude: f.latitude,
        longitude: f.longitude,
        horizontalAccuracyMeters: f.horizontalAccuracyMeters,
        locationTimestampUnixMs: f.locationTimestampUnixMs,
      })),
      validation: {
        isValid: currentFix.isValid,
        rulesetVersion: 1,
        maxAccuracyMeters: 100,
        maxAgeMs: 30000,
        maxReasonableSpeedMps: 80,
      },
    };

    const locationJsonStr = JSON.stringify(locationJson, null, 2);
    const locationResult = await NativePackage.writeUtf8File({
      filename: 'location.json',
      utf8Content: locationJsonStr,
    });
    files.push({ pathInZip: 'location.json', uri: locationResult.uri });
    const locationHash = await NativePackage.sha256File(locationResult.uri);
    hashes.push({ pathInZip: 'location.json', sha256Hex: locationHash });

    // Build deviceRecord.json
    const deviceRecordResult = await NativePackage.writeUtf8File({
      filename: 'deviceRecord.json',
      utf8Content: JSON.stringify(deviceRecord, null, 2),
    });
    files.push({ pathInZip: 'deviceRecord.json', uri: deviceRecordResult.uri });
    const deviceHash = await NativePackage.sha256File(deviceRecordResult.uri);
    hashes.push({ pathInZip: 'deviceRecord.json', sha256Hex: deviceHash });

    // Export public key
    const publicKeyAsc = await NativeDeviceKey.exportPublicKeyAsc();
    const pubKeyResult = await NativePackage.writeUtf8File({
      filename: 'public_key.asc',
      utf8Content: publicKeyAsc,
    });
    files.push({ pathInZip: 'public_key.asc', uri: pubKeyResult.uri });
    const pubKeyHash = await NativePackage.sha256File(pubKeyResult.uri);
    hashes.push({ pathInZip: 'public_key.asc', sha256Hex: pubKeyHash });

    // Build hashes.txt
    const hashesTxt = buildHashesTxt(hashes);
    const hashesResult = await NativePackage.writeUtf8File({
      filename: 'hashes.txt',
      utf8Content: hashesTxt,
    });
    // DO NOT add hashes.txt to the hashes list (spec requirement)

    // Sign hashes.txt
    const sigResult = await NativeDeviceKey.signHashesTxtDetachedGpg({
      hashesTxtUtf8: hashesTxt,
      armor: true,
    });
    files.push({ pathInZip: 'sig.gpg', uri: sigResult.signatureUri });

    // Create zip
    const zipResult = await NativePackage.createZipPackage({
      packageId,
      files: [
        ...files,
        { pathInZip: 'hashes.txt', uri: hashesResult.uri },
      ],
    });

    // Share
    await NativePackage.shareFile({
      uri: zipResult.zipUri,
      mimeType: 'application/zip',
      title: `groundpin_attendance_${packageId}.zip`,
    });
  }, []);

  // ---- Main Button Handler ----

  const handleMainButtonPress = useCallback(async () => {
    if (buttonState === 'red_invalid') {
      Alert.alert('无法打卡', '等待有效 GNSS 定位');
      return;
    }

    if (buttonState === 'yellow_attachment_only') {
      Alert.alert('仅可添加附件', '当前只可添加附件，打卡需要当前 GNSS 有效');
      return;
    }

    // Green: generate package
    if (isGenerating) {
      return;
    }

    setIsGenerating(true);

    try {
      await generatePackage();
      setStatusText('证据包已生成');
    } catch (err: any) {
      Alert.alert('生成失败', err?.message || '未知错误');
    } finally {
      setIsGenerating(false);
    }
  }, [buttonState, generatePackage, isGenerating]);

  // ---- Media Handlers ----

  const getCurrentAnchorInfo = useCallback(async (): Promise<{
    anchorFix: LocationFix;
    clock: EvidenceClock;
    evidenceTime: EvidenceTime;
  }> => {
    const fix = currentFixRef.current;
    const clock = anchorClockRef.current;

    // If current fix is valid AND clock is set, use it
    if (fix && fix.isValid && clock) {
      const monotonicMs = await NativeLocation.getCurrentMonotonicMs();
      const evidenceTime = getEvidenceTime(clock, monotonicMs);
      return { anchorFix: fix, clock, evidenceTime };
    }

    // If yellow state (clock exists, fix may be invalid or null)
    if (clock) {
      const monotonicMs = await NativeLocation.getCurrentMonotonicMs();
      if (isClockWithinWindow(clock, monotonicMs, ATTACHMENT_WINDOW_MS)) {
        const evidenceTime = getEvidenceTime(clock, monotonicMs);
        // In yellow state, the current fix may be invalid.
        // Use the current fix for coordinate data if available,
        // otherwise construct a minimal fix from what we know.
        const anchorFix: LocationFix = fix
          ? { ...fix, id: clock.anchorLocationFixId }
          : {
              id: clock.anchorLocationFixId,
              latitude: 0,
              longitude: 0,
              horizontalAccuracyMeters: 999,
              locationTimestampUnixMs: clock.anchorLocationTimestampUnixMs,
              monotonicTimestampMs: 0,
              source: {
                platform: NativeLocation.getPlatform(),
                provider: 'unknown',
              },
              accuracyAuthorization: 'unknown',
              ageMsAtReceive: 0,
              isValid: false,
              invalidReasons: ['anchor_only'],
              riskFlags: [],
            };
        return { anchorFix, clock, evidenceTime };
      }
    }

    throw new Error('最近 10 分钟内没有有效定位锚点，不能添加附件');
  }, []);

  const handleAddText = useCallback(async () => {
    try {
      const { anchorFix, clock, evidenceTime } = await getCurrentAnchorInfo();
      const attachmentId = generateId();
      const sid = shortId();
      const filename = FileNames.buildAttachmentFileName('text', evidenceTime.evidenceTimeUnixMs, sid);
      const anchorFilename = FileNames.buildAnchorFileName('text', evidenceTime.evidenceTimeUnixMs, sid);

      // Write text content
      const textResult = await NativePackage.writeUtf8File({
        filename,
        utf8Content: textInputValue,
      });

      const record: AttachmentRecord = {
        id: attachmentId,
        type: 'text',
        filename,
        anchorFilename,
        pathInZip: FileNames.buildZipPath(filename),
        anchorPathInZip: FileNames.buildZipPath(anchorFilename),
        uri: textResult.uri,
        anchorJsonUri: '',
        mimeType: FileNames.getMimeType('text'),
        sizeBytes: textResult.sizeBytes,
        anchorJsonSizeBytes: 0,
        evidenceTimeUnixMs: evidenceTime.evidenceTimeUnixMs,
        sourceLocationFixId: anchorFix.id,
      };

      const anchorJson = buildAnchorJson(record, anchorFix, clock, evidenceTime);

      const anchorResult = await NativePackage.writeUtf8File({
        filename: anchorFilename,
        utf8Content: serializeAnchorJson(anchorJson),
      });

      record.anchorJsonUri = anchorResult.uri;
      record.anchorJsonSizeBytes = anchorResult.sizeBytes;

      await AttachmentStore.addAttachment(record);
      const count = await AttachmentStore.getAttachmentCount();
      setAttachmentCount(count);
      setTextModalVisible(false);
      setTextInputValue('');
    } catch (err: any) {
      Alert.alert('添加文字失败', err?.message || '未知错误');
    }
  }, [getCurrentAnchorInfo, textInputValue]);

  const handleRecordAudio = useCallback(async () => {
    try {
      const { evidenceTime } = await getCurrentAnchorInfo();
      const record = await NativeMedia.recordAudioM4a({
        evidenceTimeUnixMs: evidenceTime.evidenceTimeUnixMs,
        sourceLocationFixId: evidenceTime.anchorLocationFixId,
      });
      await AttachmentStore.addAttachment(record);
      const count = await AttachmentStore.getAttachmentCount();
      setAttachmentCount(count);
    } catch (err: any) {
      Alert.alert('录音失败', err?.message || '未知错误');
    }
  }, [getCurrentAnchorInfo]);

  const handleCapturePhoto = useCallback(async () => {
    try {
      const { evidenceTime } = await getCurrentAnchorInfo();
      const record = await NativeMedia.capturePhotoJpg({
        evidenceTimeUnixMs: evidenceTime.evidenceTimeUnixMs,
        sourceLocationFixId: evidenceTime.anchorLocationFixId,
      });
      await AttachmentStore.addAttachment(record);
      const count = await AttachmentStore.getAttachmentCount();
      setAttachmentCount(count);
    } catch (err: any) {
      Alert.alert('拍照失败', err?.message || '未知错误');
    }
  }, [getCurrentAnchorInfo]);

  const handleCaptureVideo = useCallback(async () => {
    try {
      const { evidenceTime } = await getCurrentAnchorInfo();
      const record = await NativeMedia.captureVideoMp4({
        evidenceTimeUnixMs: evidenceTime.evidenceTimeUnixMs,
        sourceLocationFixId: evidenceTime.anchorLocationFixId,
      });
      await AttachmentStore.addAttachment(record);
      const count = await AttachmentStore.getAttachmentCount();
      setAttachmentCount(count);
    } catch (err: any) {
      Alert.alert('录视频失败', err?.message || '未知错误');
    }
  }, [getCurrentAnchorInfo]);

  // ---- Button Colors ----

  const buttonColor =
    buttonState === 'green_check_in'
      ? '#2ecc71'
      : buttonState === 'yellow_attachment_only'
      ? '#f39c12'
      : '#e74c3c';

  const buttonLabel =
    buttonState === 'green_check_in'
      ? '打卡'
      : buttonState === 'yellow_attachment_only'
      ? '仅可添加附件'
      : '无法打卡';

  const attachmentsEnabled =
    buttonState === 'green_check_in' || buttonState === 'yellow_attachment_only';

  // ---- Render ----

  return (
    <View style={styles.container}>
      {/* Top bar — attachment badge */}
      <TouchableOpacity
        style={styles.attachmentBadge}
        onPress={() => navigation.navigate('Attachments')}
      >
        <Text style={styles.attachmentBadgeText}>
          {attachmentCount > 0 ? `附件 (${attachmentCount})` : '附件'}
        </Text>
      </TouchableOpacity>

      {/* Main circular button */}
      <TouchableOpacity
        style={[styles.mainButton, { backgroundColor: buttonColor }]}
        onPress={handleMainButtonPress}
        activeOpacity={0.7}
        disabled={isGenerating}
      >
        <Text style={styles.mainButtonText}>
          {isGenerating ? '生成中...' : buttonLabel}
        </Text>
      </TouchableOpacity>

      {/* Status text */}
      <Text style={styles.statusText}>{statusText}</Text>

      {/* Bottom media buttons */}
      <View style={styles.mediaBar}>
        <TouchableOpacity
          style={[
            styles.mediaButton,
            !attachmentsEnabled && styles.mediaButtonDisabled,
          ]}
          onPress={() => setTextModalVisible(true)}
          disabled={!attachmentsEnabled}
        >
          <Text
            style={[
              styles.mediaButtonText,
              !attachmentsEnabled && styles.mediaButtonTextDisabled,
            ]}
          >
            文字
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.mediaButton,
            !attachmentsEnabled && styles.mediaButtonDisabled,
          ]}
          onPress={handleRecordAudio}
          disabled={!attachmentsEnabled}
        >
          <Text
            style={[
              styles.mediaButtonText,
              !attachmentsEnabled && styles.mediaButtonTextDisabled,
            ]}
          >
            录音
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.mediaButton,
            !attachmentsEnabled && styles.mediaButtonDisabled,
          ]}
          onPress={handleCapturePhoto}
          disabled={!attachmentsEnabled}
        >
          <Text
            style={[
              styles.mediaButtonText,
              !attachmentsEnabled && styles.mediaButtonTextDisabled,
            ]}
          >
            拍照
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.mediaButton,
            !attachmentsEnabled && styles.mediaButtonDisabled,
          ]}
          onPress={handleCaptureVideo}
          disabled={!attachmentsEnabled}
        >
          <Text
            style={[
              styles.mediaButtonText,
              !attachmentsEnabled && styles.mediaButtonTextDisabled,
            ]}
          >
            视频
          </Text>
        </TouchableOpacity>
      </View>

      {/* Text input modal */}
      <Modal
        visible={textModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setTextModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>添加文字说明</Text>
            <TextInput
              style={styles.textInput}
              multiline
              placeholder="输入文字说明..."
              value={textInputValue}
              onChangeText={setTextInputValue}
              numberOfLines={5}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => {
                  setTextModalVisible(false);
                  setTextInputValue('');
                }}
              >
                <Text style={styles.modalCancelText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalConfirmButton,
                  !textInputValue.trim() && styles.modalConfirmButtonDisabled,
                ]}
                onPress={handleAddText}
                disabled={!textInputValue.trim()}
              >
                <Text style={styles.modalConfirmText}>保存</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ---- Styles ----

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
  },
  attachmentBadge: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 40,
    right: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
  },
  attachmentBadgeText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  mainButton: {
    width: 180,
    height: 180,
    borderRadius: 90,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  mainButtonText: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '700',
  },
  statusText: {
    color: '#a0a0b0',
    fontSize: 14,
    marginTop: 24,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  mediaBar: {
    flexDirection: 'row',
    position: 'absolute',
    bottom: 60,
    left: 0,
    right: 0,
    justifyContent: 'space-evenly',
    paddingHorizontal: 20,
  },
  mediaButton: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    minWidth: 60,
    alignItems: 'center',
  },
  mediaButtonDisabled: {
    opacity: 0.3,
  },
  mediaButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  mediaButtonTextDisabled: {
    color: '#666666',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#2a2a3e',
    borderRadius: 16,
    padding: 24,
    width: '85%',
    maxWidth: 400,
  },
  modalTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
  },
  textInput: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 8,
    padding: 12,
    color: '#ffffff',
    fontSize: 14,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 16,
    gap: 12,
  },
  modalCancelButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  modalCancelText: {
    color: '#a0a0b0',
    fontSize: 14,
  },
  modalConfirmButton: {
    backgroundColor: '#2ecc71',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  modalConfirmButtonDisabled: {
    opacity: 0.4,
  },
  modalConfirmText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
});
