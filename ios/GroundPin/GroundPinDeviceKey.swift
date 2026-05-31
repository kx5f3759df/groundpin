import Foundation
import Security

// MARK: - OpenPGP Minimal Utilities (RFC 4880)

/// Tag numbers for OpenPGP packet types
enum OpenPGPTag: UInt8 {
  case publicKey = 6
  case userID = 13
  case signature = 2
}

/// OpenPGP public-key algorithms
enum OpenPGPPublicKeyAlgorithm: UInt8 {
  case ecdsa = 19  // ECDSA (deprecated number in RFC 6637, but widely compatible)
}

/// OpenPGP hash algorithms
enum OpenPGPHashAlgorithm: UInt8 {
  case sha256 = 8
}

/// Write an OpenPGP packet header (old format)
func writeOpenPGPPacketHeader(_ tag: OpenPGPTag, bodyLength: Int) -> Data {
  var header = Data()
  let tagByte = (tag.rawValue << 2) | 0x80  // old format, tag<<2 | 0x80
  header.append(tagByte)

  if bodyLength < 192 {
    header.append(UInt8(bodyLength))
  } else if bodyLength < 8384 {
    let len = bodyLength - 192
    header.append(UInt8(192 + (len >> 8)))
    header.append(UInt8(len & 0xFF))
  } else {
    header.append(0xFF)
    var len = UInt32(bodyLength).bigEndian
    withUnsafeBytes(of: &len) { header.append(contentsOf: $0) }
  }

  return header
}

/// Write an OpenPGP MPI (multi-precision integer)
func writeMPI(_ data: Data) -> Data {
  var mpi = Data()
  var bitLength = UInt16(data.count * 8).bigEndian
  withUnsafeBytes(of: &bitLength) { mpi.append(contentsOf: $0) }
  mpi.append(data)
  return mpi
}

/// Write a timestamp field (4 bytes, big-endian)
func writeTimestamp(_ timestamp: UInt32) -> Data {
  var ts = timestamp.bigEndian
  return withUnsafeBytes(of: &ts) { Data($0) }
}

/// Write an OpenPGP public-key packet for ECDSA P-256
func writePublicKeyPacket(
  timestamp: UInt32,
  publicKey: SecKey
) throws -> Data {
  var body = Data()

  // Version 4
  body.append(4)

  // Creation time
  body.append(writeTimestamp(timestamp))

  // Algorithm: ECDSA
  body.append(OpenPGPPublicKeyAlgorithm.ecdsa.rawValue)

  // Curve OID for NIST P-256: 1.2.840.10045.3.1.7
  let curveOID: [UInt8] = [0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x03, 0x01, 0x07]
  body.append(UInt8(curveOID.count))
  body.append(contentsOf: curveOID)

  // EC point in uncompressed format (0x04 || x || y)
  guard let publicKeyData = exportRawPublicKey(publicKey) else {
    throw NSError(domain: "GroundPin", code: 1, userInfo: [NSLocalizedDescriptionKey: "Failed to export public key"])
  }

  // Parse the raw key data. For P-256, raw export is 65 bytes: 0x04 || x(32) || y(32)
  if publicKeyData.count == 65 && publicKeyData[0] == 0x04 {
    body.append(contentsOf: publicKeyData)  // Include full uncompressed point
  } else {
    // Unknown format — write as MPI
    body.append(writeMPI(publicKeyData))
  }

  return writeOpenPGPPacketHeader(.publicKey, bodyLength: body.count) + body
}

/// Write a User ID packet
func writeUserIDPacket(_ userID: String) -> Data {
  guard let data = userID.data(using: .utf8) else { return Data() }
  return writeOpenPGPPacketHeader(.userID, bodyLength: data.count) + data
}

/// Write a signature packet (type 2, detached signature) for hashed data
func writeSignaturePacket(
  hashedData: Data,
  privateKey: SecKey,
  timestamp: UInt32
) throws -> Data {
  // Hash the data with SHA-256
  let hash = sha256(hashedData)

  // Sign the hash with SecKey
  guard let rawSig = signData(hash, with: privateKey) else {
    throw NSError(domain: "GroundPin", code: 2, userInfo: [NSLocalizedDescriptionKey: "Signing failed"])
  }

  var body = Data()

  // Version 4
  body.append(4)

  // Signature type: 0x00 = binary document detached signature
  body.append(0x00)

  // Public-key algorithm: ECDSA
  body.append(OpenPGPPublicKeyAlgorithm.ecdsa.rawValue)

  // Hash algorithm: SHA-256
  body.append(OpenPGPHashAlgorithm.sha256.rawValue)

  // Hashed subpackets (empty for minimal signature)
  let hashedSubpacketsLength = UInt16(0).bigEndian
  var hsLen = hashedSubpacketsLength
  withUnsafeBytes(of: &hsLen) { body.append(contentsOf: $0) }

  // Unhashed subpackets (empty for minimal signature)
  let unhashedSubpacketsLength = UInt16(0).bigEndian
  var uhsLen = unhashedSubpacketsLength
  withUnsafeBytes(of: &uhsLen) { body.append(contentsOf: $0) }

  // Hash prefix (first 2 bytes of hash)
  body.append(hash.prefix(2))

  // ECDSA signature is r || s (raw format)
  body.append(rawSig)

  return writeOpenPGPPacketHeader(.signature, bodyLength: body.count) + body
}

/// ASCII armor a binary OpenPGP message
func asciiArmor(_ data: Data, label: String) -> String {
  let base64 = data.base64EncodedString()
  var lines: [String] = []
  lines.append("-----BEGIN PGP \(label)-----")
  lines.append("")

  // Split into 64-char lines
  var pos = base64.startIndex
  while pos < base64.endIndex {
    let end = base64.index(pos, offsetBy: 64, limitedBy: base64.endIndex) ?? base64.endIndex
    lines.append(String(base64[pos..<end]))
    pos = end
  }

  // CRC24
  let crc = crc24(data)
  lines.append("=\(crc.base64Encoded4())")
  lines.append("-----END PGP \(label)-----")
  lines.append("")

  return lines.joined(separator: "\n")
}

/// Compute CRC24 for ASCII armor
func crc24(_ data: Data) -> UInt32 {
  let poly: UInt32 = 0x864CFB
  var crc: UInt32 = 0xB704CE
  for byte in data {
    crc ^= UInt32(byte) << 16
    for _ in 0..<8 {
      crc <<= 1
      if (crc & 0x1000000) != 0 {
        crc ^= poly
      }
    }
  }
  return crc & 0xFFFFFF
}

extension UInt32 {
  func base64Encoded4() -> String {
    let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/")
    var chars: [Character] = []
    var val = self
    for _ in 0..<4 {
      chars.append(alphabet[Int(val & 0x3F)])
      val >>= 6
    }
    return String(chars.reversed())
  }
}

// MARK: - Crypto Helpers

func sha256(_ data: Data) -> Data {
  var hash = Data(count: 32)
  hash.withUnsafeMutableBytes { hashPtr in
    data.withUnsafeBytes { dataPtr in
      CC_SHA256(dataPtr.baseAddress, CC_LONG(data.count), hashPtr.bindMemory(to: UInt8.self).baseAddress)
    }
  }
  return hash
}

func signData(_ hash: Data, with privateKey: SecKey) -> Data? {
  var error: Unmanaged<CFError>?
  guard let signature = SecKeyCreateSignature(
    privateKey,
    .ecdsaSignatureMessageX962SHA256,
    hash as CFData,
    &error
  ) else {
    return nil
  }
  return signature as Data
}

func exportRawPublicKey(_ key: SecKey) -> Data? {
  var error: Unmanaged<CFError>?
  guard let data = SecKeyCopyExternalRepresentation(key, &error) else {
    return nil
  }
  return data as Data
}

// MARK: - Keychain Store

func saveToKeychain(_ key: SecKey, tag: String) throws {
  let addQuery: [String: Any] = [
    kSecClass as String: kSecClassKey,
    kSecAttrApplicationTag as String: tag.data(using: .utf8)!,
    kSecValueRef as String: key,
    kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
  ]
  SecItemDelete(addQuery as CFDictionary)
  let status = SecItemAdd(addQuery as CFDictionary, nil)
  guard status == errSecSuccess else {
    throw NSError(domain: "GroundPin", code: Int(status), userInfo: [NSLocalizedDescriptionKey: "Keychain save failed"])
  }
}

func loadFromKeychain(tag: String) -> SecKey? {
  let query: [String: Any] = [
    kSecClass as String: kSecClassKey,
    kSecAttrApplicationTag as String: tag.data(using: .utf8)!,
    kSecReturnRef as String: true,
  ]
  var item: CFTypeRef?
  let status = SecItemCopyMatching(query as CFDictionary, &item)
  guard status == errSecSuccess else { return nil }
  return (item as! SecKey)
}

func deleteFromKeychain(tag: String) {
  let query: [String: Any] = [
    kSecClass as String: kSecClassKey,
    kSecAttrApplicationTag as String: tag.data(using: .utf8)!,
  ]
  SecItemDelete(query as CFDictionary)
}

// MARK: - ECDSA P-256 Key Generation

func generateECDSAKeyPair() throws -> (privateKey: SecKey, publicKey: SecKey) {
  let attributes: [String: Any] = [
    kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
    kSecAttrKeySizeInBits as String: 256,
    kSecPrivateKeyAttrs as String: [
      kSecAttrIsPermanent as String: false,
    ],
  ]

  var error: Unmanaged<CFError>?
  guard let privateKey = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
    throw error!.takeRetainedValue() as Error
  }
  guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
    throw NSError(domain: "GroundPin", code: 3, userInfo: [NSLocalizedDescriptionKey: "Public key derivation failed"])
  }
  return (privateKey, publicKey)
}

// MARK: - React Native Module

@objc(GroundPinDeviceKey)
class GroundPinDeviceKey: NSObject {

  private let keyTag = "com.groundpin.devicekey"

  @objc static func requiresMainQueueSetup() -> Bool {
    return false
  }

  @objc(initializeOrRotateDeviceKey:rejecter:)
  func initializeOrRotateDeviceKey(
    _ resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global().async {
      do {
        // Check if key already exists in Keychain
        if let existingPrivateKey = loadFromKeychain(tag: self.keyTag) {
          guard let existingPublicKey = SecKeyCopyPublicKey(existingPrivateKey) else {
            throw NSError(domain: "GroundPin", code: 4, userInfo: [NSLocalizedDescriptionKey: "Public key load failed"])
          }

          guard let pubKeyData = exportRawPublicKey(existingPublicKey) else {
            throw NSError(domain: "GroundPin", code: 5, userInfo: [NSLocalizedDescriptionKey: "Public key export failed"])
          }

          let fingerprint = sha256(pubKeyData).prefix(20).map { String(format: "%02X", $0) }.joined()

          let deviceId = self.getDeviceIdentifier()
          let record: [String: Any] = [
            "schemaVersion": 1,
            "platform": "ios",
            "appScopedDeviceId": deviceId,
            "keyUserId": "device:\(deviceId)",
            "keyAlgorithm": "OpenPGP-ECDSA-P256",
            "publicKeyFingerprint": fingerprint,
            "publicKeyFile": "public_key.asc",
          ]
          resolve(record)
          return
        }

        // Generate new key pair
        let (privateKey, publicKey) = try generateECDSAKeyPair()

        // Save to Keychain
        try saveToKeychain(privateKey, tag: self.keyTag)

        guard let pubKeyData = exportRawPublicKey(publicKey) else {
          throw NSError(domain: "GroundPin", code: 5, userInfo: [NSLocalizedDescriptionKey: "Public key export failed"])
        }

        let fingerprint = sha256(pubKeyData).prefix(20).map { String(format: "%02X", $0) }.joined()

        let deviceId = self.getDeviceIdentifier()
        let record: [String: Any] = [
          "schemaVersion": 1,
          "platform": "ios",
          "appScopedDeviceId": deviceId,
          "keyUserId": "device:\(deviceId)",
          "keyAlgorithm": "OpenPGP-ECDSA-P256",
          "publicKeyFingerprint": fingerprint,
          "publicKeyFile": "public_key.asc",
        ]
        resolve(record)
      } catch {
        reject("KEY_ERROR", error.localizedDescription, error)
      }
    }
  }

  @objc(exportPublicKeyAsc:rejecter:)
  func exportPublicKeyAsc(
    _ resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global().async {
      do {
        guard let privateKey = loadFromKeychain(tag: self.keyTag),
              let publicKey = SecKeyCopyPublicKey(privateKey) else {
          throw NSError(domain: "GroundPin", code: 6, userInfo: [NSLocalizedDescriptionKey: "Key not found"])
        }

        let timestamp = UInt32(Date().timeIntervalSince1970)
        let deviceId = self.getDeviceIdentifier()

        let pubKeyPacket = try writePublicKeyPacket(timestamp: timestamp, publicKey: publicKey)
        let userIDPacket = writeUserIDPacket("device:\(deviceId)")
        let pubKeyBlock = pubKeyPacket + userIDPacket

        let armored = asciiArmor(pubKeyBlock, label: "PUBLIC KEY BLOCK")
        resolve(armored)
      } catch {
        reject("EXPORT_ERROR", error.localizedDescription, error)
      }
    }
  }

  @objc(signHashesTxtDetachedGpg:resolver:rejecter:)
  func signHashesTxtDetachedGpg(
    _ input: [String: Any],
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global().async {
      do {
        guard let privateKey = loadFromKeychain(tag: self.keyTag) else {
          throw NSError(domain: "GroundPin", code: 7, userInfo: [NSLocalizedDescriptionKey: "Key not found"])
        }

        guard let hashesTxtUtf8 = input["hashesTxtUtf8"] as? String else {
          throw NSError(domain: "GroundPin", code: 8, userInfo: [NSLocalizedDescriptionKey: "Missing hashesTxtUtf8"])
        }
        let armor = input["armor"] as? Bool ?? true

        guard let data = hashesTxtUtf8.data(using: .utf8) else {
          throw NSError(domain: "GroundPin", code: 9, userInfo: [NSLocalizedDescriptionKey: "UTF-8 encoding failed"])
        }

        let timestamp = UInt32(Date().timeIntervalSince1970)
        let sigPacket = try writeSignaturePacket(
          hashedData: data,
          privateKey: privateKey,
          timestamp: timestamp
        )

        // Write to temp file
        let tempDir = NSTemporaryDirectory()
        let fileName = "sig.gpg"
        let filePath = (tempDir as NSString).appendingPathComponent(fileName)

        let output: Data
        if armor {
          let armored = asciiArmor(sigPacket, label: "SIGNATURE")
          FileManager.default.createFile(atPath: filePath, contents: armored.data(using: .utf8))
          output = armored.data(using: .utf8)!
        } else {
          FileManager.default.createFile(atPath: filePath, contents: sigPacket)
          output = sigPacket
        }

        let result: [String: Any] = [
          "signatureUri": URL(fileURLWithPath: filePath).absoluteString,
          "signatureFileName": "sig.gpg",
          "isArmored": armor,
        ]
        resolve(result)
      } catch {
        reject("SIGN_ERROR", error.localizedDescription, error)
      }
    }
  }

  private func getDeviceIdentifier() -> String {
    if let idfv = UIDevice.current.identifierForVendor?.uuidString {
      return idfv
    }
    // Fallback UUID stored in Keychain
    let tag = "com.groundpin.deviceid"
    if let existing = loadStringFromKeychain(tag: tag) {
      return existing
    }
    let newID = UUID().uuidString
    saveStringToKeychain(newID, tag: tag)
    return newID
  }
}

// MARK: - String Keychain (for device ID)

func saveStringToKeychain(_ string: String, tag: String) {
  let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrAccount as String: tag,
    kSecValueData as String: string.data(using: .utf8)!,
    kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
  ]
  SecItemDelete(query as CFDictionary)
  SecItemAdd(query as CFDictionary, nil)
}

func loadStringFromKeychain(tag: String) -> String? {
  let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrAccount as String: tag,
    kSecReturnData as String: true,
    kSecMatchLimit as String: kSecMatchLimitOne,
  ]
  var item: CFTypeRef?
  let status = SecItemCopyMatching(query as CFDictionary, &item)
  guard status == errSecSuccess, let data = item as? Data else { return nil }
  return String(data: data, encoding: .utf8)
}
