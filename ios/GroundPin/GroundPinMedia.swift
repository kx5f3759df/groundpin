import AVFoundation
import UIKit

@objc(GroundPinMedia)
class GroundPinMedia: NSObject {

  private var audioRecorder: AVAudioRecorder?
  private var audioCompletion: ((String?, Error?) -> Void)?

  @objc static func requiresMainQueueSetup() -> Bool {
    return true
  }

  // MARK: - Audio Recording

  @objc(recordAudioM4a:resolver:rejecter:)
  func recordAudioM4a(
    _ input: [String: Any],
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      self.startAudioRecording(input: input, resolve: resolve, reject: reject)
    }
  }

  private func startAudioRecording(
    input: [String: Any],
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    let evidenceTimeUnixMs = input["evidenceTimeUnixMs"] as? Int64 ?? 0
    let sourceLocationFixId = input["sourceLocationFixId"] as? String ?? ""

    // Prepare audio session
    let session = AVAudioSession.sharedInstance()
    do {
      try session.setCategory(.playAndRecord, mode: .default)
      try session.setActive(true)
    } catch {
      reject("AUDIO_SESSION_ERROR", error.localizedDescription, error)
      return
    }

    // Generate file name
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

    do {
      audioRecorder = try AVAudioRecorder(url: fileURL, settings: settings)
      audioRecorder?.record()

      // After a delay (max 60s or until stopped), finalize
      DispatchQueue.main.asyncAfter(deadline: .now() + 60) {
        self.stopRecordingAndFinalize(
          fileURL: fileURL,
          filename: filename,
          anchorFilename: anchorFilename,
          evidenceTimeUnixMs: evidenceTimeUnixMs,
          sourceLocationFixId: sourceLocationFixId,
          resolve: resolve,
          reject: reject
        )
      }
    } catch {
      reject("RECORD_ERROR", error.localizedDescription, error)
    }
  }

  private func stopRecordingAndFinalize(
    fileURL: URL,
    filename: String,
    anchorFilename: String,
    evidenceTimeUnixMs: Int64,
    sourceLocationFixId: String,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    audioRecorder?.stop()

    let fileManager = FileManager.default
    guard let attrs = try? fileManager.attributesOfItem(atPath: fileURL.path),
          let fileSize = attrs[.size] as? Int64 else {
      reject("FILE_ERROR", "Could not read audio file", nil)
      return
    }

    let attachmentId = UUID().uuidString
    let pathInZip = "attachments/\(filename)"
    let anchorPathInZip = "attachments/\(anchorFilename)"

    let result: [String: Any] = [
      "id": attachmentId,
      "type": "audio",
      "filename": filename,
      "anchorFilename": anchorFilename,
      "pathInZip": pathInZip,
      "anchorPathInZip": anchorPathInZip,
      "uri": fileURL.absoluteString,
      "anchorJsonUri": "",
      "mimeType": "audio/mp4",
      "sizeBytes": NSNumber(value: fileSize),
      "anchorJsonSizeBytes": 0,
      "evidenceTimeUnixMs": NSNumber(value: evidenceTimeUnixMs),
      "sourceLocationFixId": sourceLocationFixId,
    ]
    resolve(result)
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

      guard let rootVC = UIApplication.shared.windows.first?.rootViewController else {
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

      guard let rootVC = UIApplication.shared.windows.first?.rootViewController else {
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
