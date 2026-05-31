package com.groundpin

import android.app.Activity
import android.content.Intent
import android.media.MediaRecorder
import android.net.Uri
import android.provider.MediaStore
import androidx.core.content.FileProvider
import com.facebook.react.bridge.*
import java.io.File
import java.util.*

class GroundPinMediaModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), ActivityEventListener {

    private var pendingPromise: Promise? = null
    private var pendingType: String? = null
    private var pendingFilename: String? = null
    private var pendingEvidenceTimeMs: Long = 0
    private var pendingSourceFixId: String = ""
    private var mediaRecorder: MediaRecorder? = null
    private var audioFile: File? = null

    init {
        reactApplicationContext.addActivityEventListener(this)
    }

    override fun getName(): String = "GroundPinMedia"

    @ReactMethod
    fun recordAudioM4a(input: ReadableMap, promise: Promise) {
        try {
            val evidenceTimeUnixMs = input.getDouble("evidenceTimeUnixMs").toLong()
            val sourceLocationFixId = input.getString("sourceLocationFixId") ?: ""
            val shortId = UUID.randomUUID().toString().replace("-", "").take(4)
            val filename = "audio_${evidenceTimeUnixMs}_${shortId}.m4a"
            val file = File(reactApplicationContext.filesDir, filename)

            mediaRecorder = MediaRecorder().apply {
                setAudioSource(MediaRecorder.AudioSource.MIC)
                setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                setAudioSamplingRate(44100)
                setAudioBitRate(128000)
                setAudioChannels(1)
                setOutputFile(file.absolutePath)
                prepare()
                start()
            }

            audioFile = file
            pendingPromise = promise
            pendingEvidenceTimeMs = evidenceTimeUnixMs
            pendingSourceFixId = sourceLocationFixId
            pendingFilename = filename
            pendingType = "audio"

            // Auto-stop after 60 seconds
            android.os.Handler(reactApplicationContext.mainLooper).postDelayed({
                if (mediaRecorder != null) {
                    finishAudioRecording()
                }
            }, 60_000)
        } catch (e: Exception) {
            promise.reject("RECORD_ERROR", e.message, e)
        }
    }

    private fun finishAudioRecording() {
        try {
            mediaRecorder?.apply {
                stop()
                release()
            }
            mediaRecorder = null

            val file = audioFile ?: throw Exception("No audio file")
            val anchorFilename = pendingFilename!!.replace(".m4a", ".json")
            val result = buildAttachmentResult(
                pendingType!!,
                pendingFilename!!,
                anchorFilename,
                file,
                pendingEvidenceTimeMs,
                pendingSourceFixId
            )
            pendingPromise?.resolve(result)
        } catch (e: Exception) {
            pendingPromise?.reject("RECORD_ERROR", e.message, e)
        }
        pendingPromise = null
        audioFile = null
    }

    @ReactMethod
    fun capturePhotoJpg(input: ReadableMap, promise: Promise) {
        val activity = currentActivity
        if (activity == null) {
            promise.reject("NO_ACTIVITY", "No current activity", null)
            return
        }

        val evidenceTimeUnixMs = input.getDouble("evidenceTimeUnixMs").toLong()
        val sourceLocationFixId = input.getString("sourceLocationFixId") ?: ""
        val shortId = UUID.randomUUID().toString().replace("-", "").take(4)
        val filename = "photo_${evidenceTimeUnixMs}_${shortId}.jpg"
        val file = File(reactApplicationContext.filesDir, filename)

        val uri: Uri = FileProvider.getUriForFile(
            reactApplicationContext,
            "${reactApplicationContext.packageName}.fileprovider",
            file
        )

        pendingPromise = promise
        pendingEvidenceTimeMs = evidenceTimeUnixMs
        pendingSourceFixId = sourceLocationFixId
        pendingFilename = filename
        pendingType = "photo"

        val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
            putExtra(MediaStore.EXTRA_OUTPUT, uri)
            addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        }
        activity.startActivityForResult(intent, 2001)
    }

    @ReactMethod
    fun captureVideoMp4(input: ReadableMap, promise: Promise) {
        val activity = currentActivity
        if (activity == null) {
            promise.reject("NO_ACTIVITY", "No current activity", null)
            return
        }

        val evidenceTimeUnixMs = input.getDouble("evidenceTimeUnixMs").toLong()
        val sourceLocationFixId = input.getString("sourceLocationFixId") ?: ""
        val shortId = UUID.randomUUID().toString().replace("-", "").take(4)
        val filename = "video_${evidenceTimeUnixMs}_${shortId}.mp4"
        val file = File(reactApplicationContext.filesDir, filename)

        val uri: Uri = FileProvider.getUriForFile(
            reactApplicationContext,
            "${reactApplicationContext.packageName}.fileprovider",
            file
        )

        pendingPromise = promise
        pendingEvidenceTimeMs = evidenceTimeUnixMs
        pendingSourceFixId = sourceLocationFixId
        pendingFilename = filename
        pendingType = "video"

        val intent = Intent(MediaStore.ACTION_VIDEO_CAPTURE).apply {
            putExtra(MediaStore.EXTRA_OUTPUT, uri)
            addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            putExtra(MediaStore.EXTRA_VIDEO_QUALITY, 0)
        }
        activity.startActivityForResult(intent, 2002)
    }

    override fun onActivityResult(
        activity: Activity?,
        requestCode: Int,
        resultCode: Int,
        data: Intent?
    ) {
        if (requestCode != 2001 && requestCode != 2002) return
        if (pendingPromise == null) return

        if (resultCode != Activity.RESULT_OK) {
            pendingPromise?.reject("CANCELLED", "User cancelled", null)
            pendingPromise = null
            return
        }

        try {
            val filename = pendingFilename!!
            val file = File(reactApplicationContext.filesDir, filename)
            if (!file.exists()) {
                throw Exception("Capture file not created")
            }

            val type = pendingType!!
            val ext = if (type == "photo") ".jpg" else ".mp4"
            val anchorFilename = filename.replace(ext, ".json")

            val result = buildAttachmentResult(
                type,
                filename,
                anchorFilename,
                file,
                pendingEvidenceTimeMs,
                pendingSourceFixId
            )
            pendingPromise?.resolve(result)
        } catch (e: Exception) {
            pendingPromise?.reject("CAPTURE_ERROR", e.message, e)
        }
        pendingPromise = null
    }

    override fun onNewIntent(intent: Intent?) {}

    private fun buildAttachmentResult(
        type: String,
        filename: String,
        anchorFilename: String,
        file: File,
        evidenceTimeUnixMs: Long,
        sourceLocationFixId: String
    ): WritableMap {
        val mimeTypes = mapOf(
            "audio" to "audio/mp4",
            "photo" to "image/jpeg",
            "video" to "video/mp4"
        )
        val result = Arguments.createMap()
        result.putString("id", UUID.randomUUID().toString())
        result.putString("type", type)
        result.putString("filename", filename)
        result.putString("anchorFilename", anchorFilename)
        result.putString("pathInZip", "attachments/$filename")
        result.putString("anchorPathInZip", "attachments/$anchorFilename")
        result.putString("uri", "file://${file.absolutePath}")
        result.putString("anchorJsonUri", "")
        result.putString("mimeType", mimeTypes[type] ?: "application/octet-stream")
        result.putInt("sizeBytes", file.length().toInt())
        result.putInt("anchorJsonSizeBytes", 0)
        result.putDouble("evidenceTimeUnixMs", evidenceTimeUnixMs.toDouble())
        result.putString("sourceLocationFixId", sourceLocationFixId)
        return result
    }
}
