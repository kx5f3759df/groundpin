package com.groundpin

import android.content.Intent
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.Arguments
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class GroundPinPackageModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "GroundPinPackage"

    // ---------------------------------------------------------------
    // FileProvider authority — must match the authority declared in
    // AndroidManifest.xml inside the <provider> element.  The
    // file_paths.xml resource must include a path for filesDir.
    // Typically something like:
    //   <files-path name="files" path="." />
    // ---------------------------------------------------------------
    companion object {
        /** Epoch fixed-point for stable ZIP entry timestamps. */
        private const val ZIP_ENTRY_FIXED_TIME_MS: Long = 0

        /**
         * Heuristic: derive the FileProvider authority from the package
         * name.  If your manifest declares a different authority, adjust
         * this string or make it configurable.
         */
        fun fileProviderAuthority(context: ReactApplicationContext): String {
            return context.packageName + ".fileprovider"
        }
    }

    // ---------------------------------------------------------------
    // SHA-256
    // ---------------------------------------------------------------

    @ReactMethod
    fun sha256File(uri: String, promise: Promise) {
        try {
            val path = stripFilePrefix(uri)
            val file = File(path)
            if (!file.exists() || !file.isFile) {
                promise.reject("HASH_ERROR", "Cannot read file: $path")
                return
            }

            val digest = MessageDigest.getInstance("SHA-256")
            BufferedInputStream(FileInputStream(file)).use { input ->
                val buffer = ByteArray(8192)
                var bytesRead: Int
                while (input.read(buffer).also { bytesRead = it } != -1) {
                    digest.update(buffer, 0, bytesRead)
                }
            }

            val hex = digest.digest().joinToString("") { "%02x".format(it) }
            promise.resolve(hex)
        } catch (e: Exception) {
            promise.reject("HASH_ERROR", e.message ?: "SHA-256 computation failed", e)
        }
    }

    // ---------------------------------------------------------------
    // Write UTF-8 File
    // ---------------------------------------------------------------

    @ReactMethod
    fun writeUtf8File(input: ReadableMap, promise: Promise) {
        try {
            val filename = input.getString("filename")
                ?: throw IllegalArgumentException("Missing 'filename'")
            val utf8Content = input.getString("utf8Content")
                ?: throw IllegalArgumentException("Missing 'utf8Content'")

            val outFile = File(reactApplicationContext.filesDir, filename)
            // Ensure parent directories exist
            outFile.parentFile?.mkdirs()

            val data = utf8Content.toByteArray(Charsets.UTF_8)
            FileOutputStream(outFile).use { fos ->
                fos.write(data)
                fos.flush()
            }

            val result: WritableMap = Arguments.createMap().apply {
                putString("uri", fileToUri(outFile))
                putInt("sizeBytes", data.size)
            }
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("WRITE_ERROR", e.message ?: "Failed to write UTF-8 file", e)
        }
    }

    // ---------------------------------------------------------------
    // ZIP Creation
    // ---------------------------------------------------------------

    @ReactMethod
    fun createZipPackage(input: ReadableMap, promise: Promise) {
        try {
            val packageId = input.getString("packageId")
                ?: throw IllegalArgumentException("Missing 'packageId'")
            val files: ReadableArray = input.getArray("files")
                ?: throw IllegalArgumentException("Missing 'files'")

            val zipFileName = "groundpin_attendance_${packageId}.zip"
            val zipFile = File(reactApplicationContext.filesDir, zipFileName)

            FileOutputStream(zipFile).buffered().use { fos ->
                ZipOutputStream(fos).use { zos ->
                    for (i in 0 until files.size()) {
                        val entry: ReadableMap = files.getMap(i)
                            ?: throw IllegalArgumentException("Missing file entry at index $i")
                        val pathInZip = entry.getString("pathInZip")
                            ?: throw IllegalArgumentException("Missing 'pathInZip' in entry $i")
                        val srcUri = entry.getString("uri")
                            ?: throw IllegalArgumentException("Missing 'uri' in entry $i")

                        val srcPath = stripFilePrefix(srcUri)
                        val srcFile = File(srcPath)

                        if (!srcFile.exists() || !srcFile.isFile) {
                            // Skip missing sources; do not fail the whole package
                            continue
                        }

                        // Normalise path separators to forward slashes for
                        // cross-platform ZIP compatibility.
                        val normalisedPath = pathInZip.replace("\\", "/")
                        val zipEntry = ZipEntry(normalisedPath)
                        // Stable entry: zero-out modification time so repeated
                        // builds of the same content produce identical ZIPs.
                        zipEntry.time = ZIP_ENTRY_FIXED_TIME_MS

                        zos.putNextEntry(zipEntry)
                        BufferedInputStream(FileInputStream(srcFile)).use { input ->
                            input.copyTo(zos)
                        }
                        zos.closeEntry()
                    }
                }
            }

            val sizeBytes = zipFile.length()
            val result: WritableMap = Arguments.createMap().apply {
                putString("zipUri", fileToUri(zipFile))
                putInt("sizeBytes", sizeBytes.toInt())
            }
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("ZIP_ERROR", e.message ?: "ZIP creation failed", e)
        }
    }

    // ---------------------------------------------------------------
    // Share via FileProvider
    // ---------------------------------------------------------------
    //
    // Requires a FileProvider declared in AndroidManifest.xml, e.g.:
    //
    //   <provider
    //     android:name="androidx.core.content.FileProvider"
    //     android:authorities="${applicationId}.fileprovider"
    //     android:exported="false"
    //     android:grantUriPermissions="true">
    //     <meta-data
    //       android:name="android.support.FILE_PROVIDER_PATHS"
    //       android:resource="@xml/file_paths" />
    //   </provider>
    //
    // And res/xml/file_paths.xml must include the filesDir path:
    //
    //   <?xml version="1.0" encoding="utf-8"?>
    //   <paths>
    //     <files-path name="files" path="." />
    //   </paths>
    //
    // ---------------------------------------------------------------

    @ReactMethod
    fun shareFile(input: ReadableMap, promise: Promise) {
        try {
            val uri = input.getString("uri")
                ?: throw IllegalArgumentException("Missing 'uri'")
            val mimeType = input.getString("mimeType")
                ?: throw IllegalArgumentException("Missing 'mimeType'")
            val title = input.getString("title")
                ?: throw IllegalArgumentException("Missing 'title'")

            val filePath = stripFilePrefix(uri)
            val file = File(filePath)
            if (!file.exists() || !file.isFile) {
                promise.reject("SHARE_ERROR", "File not found: $filePath")
                return
            }

            val authority = fileProviderAuthority(reactApplicationContext)
            val contentUri = FileProvider.getUriForFile(reactApplicationContext, authority, file)

            val intent = Intent(Intent.ACTION_SEND).apply {
                type = mimeType
                putExtra(Intent.EXTRA_STREAM, contentUri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }

            val chooser = Intent.createChooser(intent, title)
            // FLAG_ACTIVITY_NEW_TASK is required when starting an activity
            // from outside an Activity context.
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

            reactApplicationContext.startActivity(chooser)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("SHARE_ERROR", e.message ?: "Share failed", e)
        }
    }

    // ---------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------

    /** Strip "file://" (or "file:") prefix if present. */
    private fun stripFilePrefix(uri: String): String {
        return when {
            uri.startsWith("file://") -> uri.substring(7)
            uri.startsWith("file:")   -> uri.substring(5)
            else                       -> uri
        }
    }

    /** Convert an absolute File to a "file://" URI string. */
    private fun fileToUri(file: File): String {
        return "file://" + file.absolutePath
    }
}
