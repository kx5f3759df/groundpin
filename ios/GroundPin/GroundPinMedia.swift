import AVFoundation
import ObjectiveC
import React
import UIKit

@objc(GroundPinMedia)
class GroundPinMedia: NSObject {

  private var audioRecorder: AVAudioRecorder?
  private var recordingFileURL: URL?
  private var recordingFilename: String?
  private var recordingAnchorFilename: String?
  private var recordingEvidenceTimeMs: Int64 = 0
  private var recordingSourceFixId: String = ""

  @objc static func requiresMainQueueSetup() -> Bool {
    return true
  }

  // MARK: - Audio Recording

  @objc(startRecordAudioM4a:resolver:rejecter:)
  func startRecordAudioM4a(
    _ input: [String: Any],
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      do {
        try self.beginAudioRecording(input: input)
        resolve(nil)
      } catch {
        reject("RECORD_ERROR", error.localizedDescription, error)
      }
    }
  }

  @objc(stopRecordAudioM4a:rejecter:)
  func stopRecordAudioM4a(
    _ resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      guard self.audioRecorder != nil else {
        reject("NOT_RECORDING", "No active recording", nil)
        return
      }
      self.stopRecordingAndFinalize(resolve: resolve, reject: reject)
    }
  }

  private func beginAudioRecording(input: [String: Any]) throws {
    if audioRecorder != nil {
      throw NSError(domain: "GroundPin", code: 1, userInfo: [NSLocalizedDescriptionKey: "Already recording"])
    }

    let evidenceTimeUnixMs = input["evidenceTimeUnixMs"] as? Int64 ?? Int64(input["evidenceTimeUnixMs"] as? Double ?? 0)
    let sourceLocationFixId = input["sourceLocationFixId"] as? String ?? ""

    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playAndRecord, mode: .default)
    try session.setActive(true)

    let shortId = String(UUID().uuidString.prefix(4))
    let filename = "audio_\(evidenceTimeUnixMs)_\(shortId).m4a"
    let anchorFilename = "audio_\(evidenceTimeUnixMs)_\(shortId).json"

    let docsDir = NSSearchPathForDirectoriesInDomains(.documentDirectory, .userDomainMask, true)[0]
    let filePath = (docsDir as NSString).appendingPathComponent(filename)
    let fileURL = URL(fileURLWithPath: filePath)

    let settings: [String: Any] = [
      AVFormatIDKey: kAudioFormatMPEG4AAC,
      AVSampleRateKey: 44100,
      AVNumberOfChannelsKey: 1,
      AVEncoderBitRateKey: 128000,
      AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
    ]

    audioRecorder = try AVAudioRecorder(url: fileURL, settings: settings)
    guard audioRecorder?.record() == true else {
      audioRecorder = nil
      throw NSError(domain: "GroundPin", code: 2, userInfo: [NSLocalizedDescriptionKey: "Failed to start recording"])
    }

    recordingFileURL = fileURL
    recordingFilename = filename
    recordingAnchorFilename = anchorFilename
    recordingEvidenceTimeMs = evidenceTimeUnixMs
    recordingSourceFixId = sourceLocationFixId
  }

  private func stopRecordingAndFinalize(
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    audioRecorder?.stop()
    audioRecorder = nil

    guard let fileURL = recordingFileURL,
          let filename = recordingFilename,
          let anchorFilename = recordingAnchorFilename else {
      reject("FILE_ERROR", "Recording metadata missing", nil)
      return
    }

    let fileManager = FileManager.default
    guard let attrs = try? fileManager.attributesOfItem(atPath: fileURL.path),
          let fileSize = attrs[.size] as? Int64,
          fileSize > 0 else {
      reject("FILE_ERROR", "Could not read audio file", nil)
      return
    }

    let result: [String: Any] = [
      "id": UUID().uuidString,
      "type": "audio",
      "filename": filename,
      "anchorFilename": anchorFilename,
      "pathInZip": "attachments/\(filename)",
      "anchorPathInZip": "attachments/\(anchorFilename)",
      "uri": fileURL.absoluteString,
      "anchorJsonUri": "",
      "mimeType": "audio/mp4",
      "sizeBytes": NSNumber(value: fileSize),
      "anchorJsonSizeBytes": 0,
      "evidenceTimeUnixMs": NSNumber(value: recordingEvidenceTimeMs),
      "sourceLocationFixId": recordingSourceFixId,
    ]

    recordingFileURL = nil
    recordingFilename = nil
    recordingAnchorFilename = nil
    recordingEvidenceTimeMs = 0
    recordingSourceFixId = ""

    resolve(result)
  }

  // Legacy — not used by JS
  @objc(recordAudioM4a:resolver:rejecter:)
  func recordAudioM4a(
    _ input: [String: Any],
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      do {
        try self.beginAudioRecording(input: input)
        DispatchQueue.main.asyncAfter(deadline: .now() + 60) {
          if self.audioRecorder != nil {
            self.stopRecordingAndFinalize(resolve: resolve, reject: reject)
          }
        }
      } catch {
        reject("RECORD_ERROR", error.localizedDescription, error)
      }
    }
  }

  // MARK: - Photo Capture

  @objc(capturePhotoJpg:resolver:rejecter:)
  func capturePhotoJpg(
    _ input: [String: Any],
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    // Photo capture requires UIImagePickerController with a presenting VC.
    // For MVP, we delegate to the Package module which can use the system camera.
    // The JS side provides a placeholder; actual capture is done via native UI.
    // We store the completion for when the picker returns.

    DispatchQueue.main.async {
      let evidenceTimeUnixMs = input["evidenceTimeUnixMs"] as? Int64 ?? 0
      let sourceLocationFixId = input["sourceLocationFixId"] as? String ?? ""

      guard let rootVC = Self.topViewController() else {
        reject("NO_VIEW", "No view controller available", nil)
        return
      }

      let picker = UIImagePickerController()
      picker.sourceType = .camera
      picker.mediaTypes = ["public.image"]
      picker.allowsEditing = false

      // Generate filename
      let shortId = String(UUID().uuidString.prefix(4))
      let filename = "photo_\(evidenceTimeUnixMs)_\(shortId).jpg"

      picker.delegate = PhotoCaptureDelegate(
        filename: filename,
        evidenceTimeUnixMs: evidenceTimeUnixMs,
        sourceLocationFixId: sourceLocationFixId,
        resolve: resolve,
        reject: reject
      )

      // Retain delegate
      objc_setAssociatedObject(picker, "delegate_retain", picker.delegate, .OBJC_ASSOCIATION_RETAIN)

      rootVC.present(picker, animated: true)
    }
  }

  // MARK: - Video Capture

  @objc(captureVideoMp4:resolver:rejecter:)
  func captureVideoMp4(
    _ input: [String: Any],
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      let evidenceTimeUnixMs = input["evidenceTimeUnixMs"] as? Int64 ?? 0
      let sourceLocationFixId = input["sourceLocationFixId"] as? String ?? ""

      guard let rootVC = Self.topViewController() else {
        reject("NO_VIEW", "No view controller available", nil)
        return
      }

      let picker = UIImagePickerController()
      picker.sourceType = .camera
      picker.mediaTypes = ["public.movie"]
      picker.videoQuality = .typeMedium
      picker.allowsEditing = false

      let shortId = String(UUID().uuidString.prefix(4))
      let filename = "video_\(evidenceTimeUnixMs)_\(shortId).mp4"

      picker.delegate = VideoCaptureDelegate(
        filename: filename,
        evidenceTimeUnixMs: evidenceTimeUnixMs,
        sourceLocationFixId: sourceLocationFixId,
        resolve: resolve,
        reject: reject
      )

      objc_setAssociatedObject(picker, "delegate_retain", picker.delegate, .OBJC_ASSOCIATION_RETAIN)

      rootVC.present(picker, animated: true)
    }
  }

  private static func topViewController() -> UIViewController? {
    let scenes = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .filter { $0.activationState == .foregroundActive || $0.activationState == .foregroundInactive }

    for scene in scenes {
      if let root = scene.windows.first(where: { $0.isKeyWindow })?.rootViewController {
        return root
      }
      if let root = scene.windows.first?.rootViewController {
        return root
      }
    }
    return nil
  }
}

// MARK: - Photo Capture Delegate

class PhotoCaptureDelegate: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
  let filename: String
  let evidenceTimeUnixMs: Int64
  let sourceLocationFixId: String
  let resolve: RCTPromiseResolveBlock
  let reject: RCTPromiseRejectBlock

  init(filename: String, evidenceTimeUnixMs: Int64, sourceLocationFixId: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    self.filename = filename
    self.evidenceTimeUnixMs = evidenceTimeUnixMs
    self.sourceLocationFixId = sourceLocationFixId
    self.resolve = resolve
    self.reject = reject
  }

  func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
    picker.dismiss(animated: true)

    guard let image = info[.originalImage] as? UIImage else {
      reject("CAPTURE_ERROR", "No image captured", nil)
      return
    }

    let docsDir = NSSearchPathForDirectoriesInDomains(.documentDirectory, .userDomainMask, true)[0]
    let filePath = (docsDir as NSString).appendingPathComponent(filename)

    guard let jpgData = image.jpegData(compressionQuality: 0.85) else {
      reject("JPEG_ERROR", "Failed to encode JPEG", nil)
      return
    }

    do {
      try jpgData.write(to: URL(fileURLWithPath: filePath))
    } catch {
      reject("WRITE_ERROR", error.localizedDescription, error)
      return
    }

    let anchorFilename = filename.replacingOccurrences(of: ".jpg", with: ".json")
    let attachmentId = UUID().uuidString

    let result: [String: Any] = [
      "id": attachmentId,
      "type": "photo",
      "filename": filename,
      "anchorFilename": anchorFilename,
      "pathInZip": "attachments/\(filename)",
      "anchorPathInZip": "attachments/\(anchorFilename)",
      "uri": URL(fileURLWithPath: filePath).absoluteString,
      "anchorJsonUri": "",
      "mimeType": "image/jpeg",
      "sizeBytes": NSNumber(value: jpgData.count),
      "anchorJsonSizeBytes": 0,
      "evidenceTimeUnixMs": NSNumber(value: evidenceTimeUnixMs),
      "sourceLocationFixId": sourceLocationFixId,
    ]
    resolve(result)
  }

  func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
    picker.dismiss(animated: true)
    reject("CANCELLED", "User cancelled", nil)
  }
}

// MARK: - Video Capture Delegate

class VideoCaptureDelegate: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
  let filename: String
  let evidenceTimeUnixMs: Int64
  let sourceLocationFixId: String
  let resolve: RCTPromiseResolveBlock
  let reject: RCTPromiseRejectBlock

  init(filename: String, evidenceTimeUnixMs: Int64, sourceLocationFixId: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    self.filename = filename
    self.evidenceTimeUnixMs = evidenceTimeUnixMs
    self.sourceLocationFixId = sourceLocationFixId
    self.resolve = resolve
    self.reject = reject
  }

  func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
    picker.dismiss(animated: true)

    guard let videoURL = info[.mediaURL] as? URL else {
      reject("CAPTURE_ERROR", "No video URL", nil)
      return
    }

    let docsDir = NSSearchPathForDirectoriesInDomains(.documentDirectory, .userDomainMask, true)[0]
    let destPath = (docsDir as NSString).appendingPathComponent(filename)
    let destURL = URL(fileURLWithPath: destPath)

    do {
      try FileManager.default.moveItem(at: videoURL, to: destURL)
    } catch {
      reject("MOVE_ERROR", error.localizedDescription, error)
      return
    }

    let attrs = try? FileManager.default.attributesOfItem(atPath: destPath)
    let fileSize = (attrs?[.size] as? Int64) ?? 0

    let anchorFilename = filename.replacingOccurrences(of: ".mp4", with: ".json")
    let attachmentId = UUID().uuidString

    let result: [String: Any] = [
      "id": attachmentId,
      "type": "video",
      "filename": filename,
      "anchorFilename": anchorFilename,
      "pathInZip": "attachments/\(filename)",
      "anchorPathInZip": "attachments/\(anchorFilename)",
      "uri": destURL.absoluteString,
      "anchorJsonUri": "",
      "mimeType": "video/mp4",
      "sizeBytes": NSNumber(value: fileSize),
      "anchorJsonSizeBytes": 0,
      "evidenceTimeUnixMs": NSNumber(value: evidenceTimeUnixMs),
      "sourceLocationFixId": sourceLocationFixId,
    ]
    resolve(result)
  }

  func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
    picker.dismiss(animated: true)
    reject("CANCELLED", "User cancelled", nil)
  }
}
