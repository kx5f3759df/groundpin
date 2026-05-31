import CommonCrypto
import Foundation
import React
import UIKit

@objc(GroundPinPackage)
class GroundPinPackage: NSObject {

  @objc static func requiresMainQueueSetup() -> Bool {
    return false
  }

  // MARK: - SHA-256

  @objc(sha256File:resolver:rejecter:)
  func sha256File(
    _ uri: String,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global().async {
      let filePath: String
      if uri.hasPrefix("file://") {
        filePath = String(uri.dropFirst(7))
      } else {
        filePath = uri
      }

      guard let data = try? Data(contentsOf: URL(fileURLWithPath: filePath)) else {
        reject("HASH_ERROR", "Cannot read file: \(filePath)", nil)
        return
      }

      let hash = Self.sha256(data)
      resolve(hash)
    }
  }

  static func sha256(_ data: Data) -> String {
    var digest = Data(count: Int(CC_SHA256_DIGEST_LENGTH))
    digest.withUnsafeMutableBytes { digestPtr in
      data.withUnsafeBytes { dataPtr in
        CC_SHA256(dataPtr.baseAddress, CC_LONG(data.count), digestPtr.bindMemory(to: UInt8.self).baseAddress)
      }
    }
    return digest.map { String(format: "%02x", $0) }.joined()
  }

  // MARK: - Write UTF-8 File

  @objc(writeUtf8File:resolver:rejecter:)
  func writeUtf8File(
    _ input: [String: Any],
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let filename = input["filename"] as? String,
          let content = input["utf8Content"] as? String,
          let data = content.data(using: .utf8) else {
      reject("WRITE_ERROR", "Invalid input", nil)
      return
    }

    let docsDir = NSSearchPathForDirectoriesInDomains(.documentDirectory, .userDomainMask, true)[0]
    let filePath = (docsDir as NSString).appendingPathComponent(filename)

    do {
      try data.write(to: URL(fileURLWithPath: filePath), options: .atomic)
      let result: [String: Any] = [
        "uri": URL(fileURLWithPath: filePath).absoluteString,
        "sizeBytes": data.count,
      ]
      resolve(result)
    } catch {
      reject("WRITE_ERROR", error.localizedDescription, error)
    }
  }

  // MARK: - ZIP Creation

  @objc(createZipPackage:resolver:rejecter:)
  func createZipPackage(
    _ input: [String: Any],
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global().async {
      do {
        guard let packageId = input["packageId"] as? String,
              let files = input["files"] as? [[String: Any]] else {
          reject("ZIP_ERROR", "Invalid input", nil)
          return
        }

        let zipFileName = "groundpin_attendance_\(packageId).zip"
        let docsDir = NSSearchPathForDirectoriesInDomains(.documentDirectory, .userDomainMask, true)[0]
        let zipPath = (docsDir as NSString).appendingPathComponent(zipFileName)

        try self.writeZip(to: zipPath, files: files)

        let attrs = try FileManager.default.attributesOfItem(atPath: zipPath)
        let fileSize = attrs[.size] as? Int64 ?? 0

        let result: [String: Any] = [
          "zipUri": URL(fileURLWithPath: zipPath).absoluteString,
          "sizeBytes": NSNumber(value: fileSize),
        ]
        resolve(result)
      } catch {
        reject("ZIP_ERROR", error.localizedDescription, error)
      }
    }
  }

  private func writeZip(to path: String, files: [[String: Any]]) throws {
    // Use system zip command via Process
    // First create a temp directory with the files
    let tempDir = NSTemporaryDirectory() + UUID().uuidString
    try FileManager.default.createDirectory(atPath: tempDir, withIntermediateDirectories: true)

    defer {
      try? FileManager.default.removeItem(atPath: tempDir)
    }

    // Create attachments subdirectory
    let attDir = (tempDir as NSString).appendingPathComponent("attachments")
    try FileManager.default.createDirectory(atPath: attDir, withIntermediateDirectories: true)

    for file in files {
      guard let pathInZip = file["pathInZip"] as? String,
            let uri = file["uri"] as? String else { continue }

      let srcPath: String
      if uri.hasPrefix("file://") {
        srcPath = String(uri.dropFirst(7))
      } else {
        srcPath = uri
      }

      let destPath: String
      if pathInZip.hasPrefix("attachments/") {
        // Place in attachments subdirectory
        let filename = String(pathInZip.dropFirst("attachments/".count))
        destPath = (attDir as NSString).appendingPathComponent(filename)
        // Ensure parent directories exist
        let destDir = (destPath as NSString).deletingLastPathComponent
        try? FileManager.default.createDirectory(atPath: destDir, withIntermediateDirectories: true)
      } else {
        // Place in root
        destPath = (tempDir as NSString).appendingPathComponent(pathInZip)
      }

      if FileManager.default.fileExists(atPath: srcPath) {
        try FileManager.default.copyItem(atPath: srcPath, toPath: destPath)
      }
    }

    // Use system zip command
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/zip")
    process.arguments = ["-r", "-q", path, "."]
    process.currentDirectoryURL = URL(fileURLWithPath: tempDir)

    let pipe = Pipe()
    process.standardError = pipe

    try process.run()
    process.waitUntilExit()

    if process.terminationStatus != 0 {
      let errorData = pipe.fileHandleForReading.readDataToEndOfFile()
      let errorStr = String(data: errorData, encoding: .utf8) ?? "Unknown error"
      throw NSError(domain: "GroundPin", code: Int(process.terminationStatus), userInfo: [NSLocalizedDescriptionKey: errorStr])
    }
  }

  // MARK: - Share

  @objc(shareFile:resolver:rejecter:)
  func shareFile(
    _ input: [String: Any],
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      guard let uri = input["uri"] as? String,
            let mimeType = input["mimeType"] as? String,
            let title = input["title"] as? String else {
        reject("SHARE_ERROR", "Invalid input", nil)
        return
      }

      let filePath: String
      if uri.hasPrefix("file://") {
        filePath = String(uri.dropFirst(7))
      } else {
        filePath = uri
      }

      let fileURL = URL(fileURLWithPath: filePath)

      guard let rootVC = Self.topViewController() else {
        reject("SHARE_ERROR", "No view controller", nil)
        return
      }

      let activityVC = UIActivityViewController(
        activityItems: [fileURL],
        applicationActivities: nil
      )
      activityVC.setValue(title, forKey: "subject")

      if let popover = activityVC.popoverPresentationController {
        popover.sourceView = rootVC.view
        popover.sourceRect = CGRect(x: rootVC.view.bounds.midX, y: rootVC.view.bounds.midY, width: 0, height: 0)
      }

      rootVC.present(activityVC, animated: true) {
        resolve(nil)
      }
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
