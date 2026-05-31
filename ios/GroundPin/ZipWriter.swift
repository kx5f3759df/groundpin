import Foundation
import zlib

/// Minimal ZIP writer for evidence packages (DEFLATE, fixed entry timestamp).
final class ZipWriter {
  private static let fixedDosTime: UInt16 = 0
  private static let fixedDosDate: UInt16 = 0

  private let handle: FileHandle
  private var centralDirectory = Data()
  private var entryCount: UInt16 = 0
  private var currentOffset: UInt32 = 0

  init(outputPath: String) throws {
    FileManager.default.createFile(atPath: outputPath, contents: nil)
    guard let handle = FileHandle(forWritingAtPath: outputPath) else {
      throw ZipWriterError.cannotCreateOutput
    }
    self.handle = handle
  }

  func addFile(pathInZip: String, sourcePath: String) throws {
    guard FileManager.default.fileExists(atPath: sourcePath) else { return }

    let fileData = try Data(contentsOf: URL(fileURLWithPath: sourcePath))
    let compressed = try deflateRaw(fileData)
    let crc = crc32Checksum(fileData)
    let localHeaderOffset = currentOffset

    var localHeader = Data()
    localHeader.appendUInt32(0x04034b50)
    localHeader.appendUInt16(20) // version needed
    localHeader.appendUInt16(0) // flags
    localHeader.appendUInt16(8) // DEFLATE
    localHeader.appendUInt16(Self.fixedDosTime)
    localHeader.appendUInt16(Self.fixedDosDate)
    localHeader.appendUInt32(crc)
    localHeader.appendUInt32(UInt32(compressed.count))
    localHeader.appendUInt32(UInt32(fileData.count))
    let nameData = Data(pathInZip.utf8)
    localHeader.appendUInt16(UInt16(nameData.count))
    localHeader.appendUInt16(0) // extra length
    localHeader.append(nameData)

    handle.write(localHeader)
    handle.write(compressed)
    currentOffset += UInt32(localHeader.count + compressed.count)

    var centralEntry = Data()
    centralEntry.appendUInt32(0x02014b50)
    centralEntry.appendUInt16(20) // version made by
    centralEntry.appendUInt16(20) // version needed
    centralEntry.appendUInt16(0)
    centralEntry.appendUInt16(8)
    centralEntry.appendUInt16(Self.fixedDosTime)
    centralEntry.appendUInt16(Self.fixedDosDate)
    centralEntry.appendUInt32(crc)
    centralEntry.appendUInt32(UInt32(compressed.count))
    centralEntry.appendUInt32(UInt32(fileData.count))
    centralEntry.appendUInt16(UInt16(nameData.count))
    centralEntry.appendUInt16(0)
    centralEntry.appendUInt16(0)
    centralEntry.appendUInt16(0)
    centralEntry.appendUInt16(0)
    centralEntry.appendUInt32(0)
    centralEntry.appendUInt32(localHeaderOffset)
    centralEntry.append(nameData)

    centralDirectory.append(centralEntry)
    entryCount += 1
  }

  func finish() throws {
    let centralDirectoryOffset = currentOffset
    handle.write(centralDirectory)
    currentOffset += UInt32(centralDirectory.count)

    var endRecord = Data()
    endRecord.appendUInt32(0x06054b50)
    endRecord.appendUInt16(0)
    endRecord.appendUInt16(0)
    endRecord.appendUInt16(entryCount)
    endRecord.appendUInt16(entryCount)
    endRecord.appendUInt32(UInt32(centralDirectory.count))
    endRecord.appendUInt32(centralDirectoryOffset)
    endRecord.appendUInt16(0)
    handle.write(endRecord)
    try handle.close()
  }

  private func deflateRaw(_ data: Data) throws -> Data {
    if data.isEmpty {
      return Data()
    }

    var stream = z_stream()
    let initStatus = deflateInit2_(
      &stream,
      Z_DEFAULT_COMPRESSION,
      Z_DEFLATED,
      -MAX_WBITS,
      8,
      Z_DEFAULT_STRATEGY,
      ZLIB_VERSION,
      Int32(MemoryLayout<z_stream>.size)
    )
    guard initStatus == Z_OK else {
      throw ZipWriterError.compressionFailed
    }
    defer { deflateEnd(&stream) }

    var output = [UInt8]()
    let chunkSize = 16_384

    let status: Int32 = try data.withUnsafeBytes { inputBuffer in
      guard let inputBase = inputBuffer.bindMemory(to: Bytef.self).baseAddress else {
        throw ZipWriterError.compressionFailed
      }
      stream.next_in = UnsafeMutablePointer<Bytef>(mutating: inputBase)
      stream.avail_in = uInt(data.count)

      var deflateStatus = Z_OK
      repeat {
        var chunk = [UInt8](repeating: 0, count: chunkSize)
        let written = chunk.withUnsafeMutableBytes { outputBuffer in
          stream.next_out = outputBuffer.bindMemory(to: Bytef.self).baseAddress
          stream.avail_out = uInt(chunkSize)
          deflateStatus = deflate(&stream, Z_FINISH)
          return chunkSize - Int(stream.avail_out)
        }
        output.append(contentsOf: chunk.prefix(written))
      } while deflateStatus == Z_OK

      return deflateStatus
    }

    guard status == Z_STREAM_END else {
      throw ZipWriterError.compressionFailed
    }
    return Data(output)
  }

  private func crc32Checksum(_ data: Data) -> UInt32 {
    data.withUnsafeBytes { buffer in
      UInt32(truncatingIfNeeded: crc32(0, buffer.baseAddress, uInt(buffer.count)))
    }
  }
}

enum ZipWriterError: Error {
  case cannotCreateOutput
  case compressionFailed
}

private extension Data {
  mutating func appendUInt16(_ value: UInt16) {
    var le = value.littleEndian
    append(UnsafeBufferPointer(start: &le, count: 1))
  }

  mutating func appendUInt32(_ value: UInt32) {
    var le = value.littleEndian
    append(UnsafeBufferPointer(start: &le, count: 1))
  }
}
