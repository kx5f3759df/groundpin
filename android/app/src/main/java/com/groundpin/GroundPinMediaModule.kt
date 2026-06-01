package com.groundpin

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener
import java.io.File
import java.util.*

class GroundPinMediaModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), ActivityEventListener, PermissionListener {

    private var pendingPromise: Promise? = null
    private var pendingType: String? = null
    private var pendingFilename: String? = null
    private var pendingEvidenceTimeMs: Long = 0
    private var pendingSourceFixId: String = ""
    private var mediaRecorder: MediaRecorder? = null
    private var audioFile: File? = null

    private var permissionPromise: Promise? = null
    private var permissionGrantedAction: (() -> Unit)? = null

    init {
        reactApplicationContext.addActivityEventListener(this)
    }

    override fun getName(): String = "GroundPinMedia"

    @ReactMethod
    fun recordAudioM4a(input: ReadableMap, promise: Promise) {
        runWithPermissions(
            promise,
            arrayOf(Manifest.permission.RECORD_AUDIO),
            PERMISSION_REQUEST_AUDIO
        ) {
            startAudioRecording(input, promise)
        }
    }

    @ReactMethod
    fun capturePhotoJpg(input: ReadableMap, promise: Promise) {
        runWithPermissions(
            promise,
            arrayOf(Manifest.permission.CAMERA),
            PERMISSION_REQUEST_CAMERA
        ) {
            launchCameraCapture(input, promise, isVideo = false)
        }
    }

    @ReactMethod
    fun captureVideoMp4(input: ReadableMap, promise: Promise) {
        runWithPermissions(
            promise,
            arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO),
            PERMISSION_REQUEST_VIDEO
        ) {
            launchCameraCapture(input, promise, isVideo = true)
        }
    }

    private fun runWithPermissions(
        promise: Promise,
        permissions: Array<String>,
        requestCode: Int,
        onGranted: () -> Unit
    ) {
        val missing = permissions.filter {
            ContextCompat.checkSelfPermission(reactApplicationContext, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isEmpty()) {
            reactApplicationContext.runOnUiQueueThread { onGranted() }
            return
        }

        val activity = currentActivity
        val permissionAware = activity as? PermissionAwareActivity
        if (permissionAware == null) {
            promise.reject("NO_ACTIVITY", "Cannot request permissions without active activity", null)
            return
        }

        permissionPromise = promise
        permissionGrantedAction = { reactApplicationContext.runOnUiQueueThread { onGranted() } }
        permissionAware.requestPermissions(missing.toTypedArray(), requestCode, this)
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<String>,
        grantResults: IntArray
    ): Boolean {
        if (requestCode != PERMISSION_REQUEST_AUDIO &&
            requestCode != PERMISSION_REQUEST_CAMERA &&
            requestCode != PERMISSION_REQUEST_VIDEO
        ) {
            return false
        }

        val granted = grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED }
        if (granted) {
            permissionGrantedAction?.invoke()
        } else {
            permissionPromise?.reject("PERMISSION_DENIED", "Required permission denied", null)
        }
        permissionPromise = null
        permissionGrantedAction = null
        return true
    }

    private fun startAudioRecording(input: ReadableMap, promise: Promise) {
        try {
            val evidenceTimeUnixMs = input.getDouble("evidenceTimeUnixMs").toLong()
            val sourceLocationFixId = input.getString("sourceLocationFixId") ?: ""
            val shortId = UUID.randomUUID().toString().replace("-", "").take(4)
            val filename = "audio_${evidenceTimeUnixMs}_${shortId}.m4a"
            val file = File(reactApplicationContext.filesDir, filename)

            mediaRecorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                MediaRecorder(reactApplicationContext)
            } else {
                @Suppress("DEPRECATION")
                MediaRecorder()
            }.apply {
                setAudioSource(MediaRecorder.AudioSource.MIC)
                setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                setAudioSamplingRate(44100)
                setAudioEncodingBitRate(128000)
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

            android.os.Handler(reactApplicationContext.mainLooper).postDelayed({
                if (mediaRecorder != null) {
                    finishAudioRecording()
                }
            }, 60_000)
        } catch (e: Exception) {
            releaseMediaRecorder()
            promise.reject("RECORD_ERROR", e.message ?: "setAudioSourceFailed", e)
        }
    }

    private fun launchCameraCapture(input: ReadableMap, promise: Promise, isVideo: Boolean) {
        val activity = currentActivity
        if (activity == null) {
            promise.reject("NO_ACTIVITY", "No current activity", null)
            return
        }

        try {
            val evidenceTimeUnixMs = input.getDouble("evidenceTimeUnixMs").toLong()
            val sourceLocationFixId = input.getString("sourceLocationFixId") ?: ""
            val shortId = UUID.randomUUID().toString().replace("-", "").take(4)
            val filename = if (isVideo) {
                "video_${evidenceTimeUnixMs}_${shortId}.mp4"
            } else {
                "photo_${evidenceTimeUnixMs}_${shortId}.jpg"
            }
            val file = File(reactApplicationContext.filesDir, filename)
            file.parentFile?.mkdirs()

            val uri: Uri = FileProvider.getUriForFile(
                reactApplicationContext,
                "${reactApplicationContext.packageName}.fileprovider",
                file
            )

            val intent = if (isVideo) {
                Intent(MediaStore.ACTION_VIDEO_CAPTURE).apply {
                    putExtra(MediaStore.EXTRA_OUTPUT, uri)
                    putExtra(MediaStore.EXTRA_VIDEO_QUALITY, 0)
                }
            } else {
                Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
                    putExtra(MediaStore.EXTRA_OUTPUT, uri)
                }
            }

            if (intent.resolveActivity(reactApplicationContext.packageManager) == null) {
                promise.reject("NO_CAMERA", "No camera app available", null)
                return
            }

            grantUriToCameraApps(activity, uri, intent)

            pendingPromise = promise
            pendingEvidenceTimeMs = evidenceTimeUnixMs
            pendingSourceFixId = sourceLocationFixId
            pendingFilename = filename
            pendingType = if (isVideo) "video" else "photo"

            val requestCode = if (isVideo) REQUEST_VIDEO else REQUEST_PHOTO
            @Suppress("DEPRECATION")
            activity.startActivityForResult(intent, requestCode)
        } catch (e: Exception) {
            clearPendingCapture()
            promise.reject("CAPTURE_ERROR", e.message, e)
        }
    }

    private fun grantUriToCameraApps(activity: Activity, uri: Uri, intent: Intent) {
        intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        val resInfoList = reactApplicationContext.packageManager.queryIntentActivities(
            intent,
            PackageManager.MATCH_DEFAULT_ONLY
        )
        for (resolveInfo in resInfoList) {
            val packageName = resolveInfo.activityInfo.packageName
            activity.grantUriPermission(
                packageName,
                uri,
                Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION
            )
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
        } finally {
            pendingPromise = null
            audioFile = null
            pendingType = null
            pendingFilename = null
        }
    }

    private fun releaseMediaRecorder() {
        try {
            mediaRecorder?.release()
        } catch (_: Exception) {
        }
        mediaRecorder = null
    }

    private fun clearPendingCapture() {
        pendingPromise = null
        pendingType = null
        pendingFilename = null
    }

    override fun onActivityResult(
        activity: Activity?,
        requestCode: Int,
        resultCode: Int,
        data: Intent?
    ) {
        if (requestCode != REQUEST_PHOTO && requestCode != REQUEST_VIDEO) return
        if (pendingPromise == null) return

        val promise = pendingPromise!!
        if (resultCode != Activity.RESULT_OK) {
            clearPendingCapture()
            promise.reject("CANCELLED", "User cancelled", null)
            return
        }

        try {
            val filename = pendingFilename ?: throw Exception("Missing filename")
            val file = File(reactApplicationContext.filesDir, filename)
            if (!file.exists() || file.length() == 0L) {
                throw Exception("Capture file not created")
            }

            val type = pendingType ?: throw Exception("Missing capture type")
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
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("CAPTURE_ERROR", e.message, e)
        } finally {
            clearPendingCapture()
        }
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

    companion object {
        private const val PERMISSION_REQUEST_AUDIO = 3001
        private const val PERMISSION_REQUEST_CAMERA = 3002
        private const val PERMISSION_REQUEST_VIDEO = 3003
        private const val REQUEST_PHOTO = 2001
        private const val REQUEST_VIDEO = 2002
    }
}
