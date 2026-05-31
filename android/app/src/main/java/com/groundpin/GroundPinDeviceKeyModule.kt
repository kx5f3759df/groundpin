package com.groundpin

import android.content.Context
import android.content.SharedPreferences
import android.provider.Settings
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.facebook.react.bridge.*
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.security.*
import java.security.spec.ECGenParameterSpec
import java.util.*

class GroundPinDeviceKeyModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val KEY_ALIAS = "GroundPin:deviceKey"
        private const val PREFS_KEY_DEVICE_ID = "appScopedDeviceId"
    }

    override fun getName(): String = "GroundPinDeviceKey"

    private val prefs: SharedPreferences =
        reactApplicationContext.getSharedPreferences("GroundPin", Context.MODE_PRIVATE)

    @ReactMethod
    fun initializeOrRotateDeviceKey(promise: Promise) {
        try {
            val deviceId = getDeviceIdentifier()
            val keystore = KeyStore.getInstance("AndroidKeyStore")
            keystore.load(null)

            // Check if key exists
            if (keystore.containsAlias(KEY_ALIAS)) {
                val entry = keystore.getEntry(KEY_ALIAS, null) as? KeyStore.PrivateKeyEntry
                if (entry != null) {
                    val publicKey = entry.certificate.publicKey
                    val fingerprint = computeFingerprint(publicKey.encoded)
                    promise.resolve(buildDeviceRecord(deviceId, fingerprint))
                    return
                }
            }

            // Generate new key
            generateKeyPair()
            val entry = keystore.getEntry(KEY_ALIAS, null) as? KeyStore.PrivateKeyEntry
                ?: throw Exception("Key generation failed")
            val publicKey = entry.certificate.publicKey
            val fingerprint = computeFingerprint(publicKey.encoded)
            promise.resolve(buildDeviceRecord(deviceId, fingerprint))

        } catch (e: Exception) {
            promise.reject("KEY_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun exportPublicKeyAsc(promise: Promise) {
        try {
            val keystore = KeyStore.getInstance("AndroidKeyStore")
            keystore.load(null)
            val entry = keystore.getEntry(KEY_ALIAS, null) as? KeyStore.PrivateKeyEntry
                ?: throw Exception("Key not found")

            val publicKey = entry.certificate.publicKey
            val deviceId = getDeviceIdentifier()
            val timestamp = (System.currentTimeMillis() / 1000).toInt()

            val pubKeyPacket = writePublicKeyPacket(timestamp, publicKey.encoded)
            val userIDPacket = writeUserIDPacket("device:$deviceId")
            val block = pubKeyPacket + userIDPacket

            val armor = asciiArmor(block, "PUBLIC KEY BLOCK")
            promise.resolve(armor)
        } catch (e: Exception) {
            promise.reject("EXPORT_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun signHashesTxtDetachedGpg(input: ReadableMap, promise: Promise) {
        try {
            val hashesTxtUtf8 = input.getString("hashesTxtUtf8")
                ?: throw Exception("Missing hashesTxtUtf8")
            val armor = if (input.hasKey("armor")) input.getBoolean("armor") else true

            val keystore = KeyStore.getInstance("AndroidKeyStore")
            keystore.load(null)
            val entry = keystore.getEntry(KEY_ALIAS, null) as? KeyStore.PrivateKeyEntry
                ?: throw Exception("Key not found")

            val data = hashesTxtUtf8.toByteArray(Charsets.UTF_8)
            val signature = Signature.getInstance("SHA256withECDSA")
            signature.initSign(entry.privateKey)
            signature.update(data)
            val rawSig = signature.sign()

            val timestamp = (System.currentTimeMillis() / 1000).toInt()
            val sigPacket = writeSignaturePacket(data, rawSig, timestamp)

            val outputData: ByteArray
            if (armor) {
                outputData = asciiArmor(sigPacket, "SIGNATURE").toByteArray(Charsets.UTF_8)
            } else {
                outputData = sigPacket
            }

            val file = java.io.File(reactApplicationContext.filesDir, "sig.gpg")
            file.writeBytes(outputData)

            val result = Arguments.createMap()
            result.putString("signatureUri", "file://${file.absolutePath}")
            result.putString("signatureFileName", "sig.gpg")
            result.putBoolean("isArmored", armor)
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("SIGN_ERROR", e.message, e)
        }
    }

    // ---- Key Generation ----

    private fun generateKeyPair() {
        val spec = KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_SIGN
        )
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setUserAuthenticationRequired(false)
            .setRandomizedEncryptionRequired(false)
            .build()

        val generator = KeyPairGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_EC,
            "AndroidKeyStore"
        )
        generator.initialize(spec)
        generator.generateKeyPair()
    }

    private fun getDeviceIdentifier(): String {
        val saved = prefs.getString(PREFS_KEY_DEVICE_ID, null)
        if (saved != null) return saved

        val androidId = Settings.Secure.getString(
            reactApplicationContext.contentResolver,
            Settings.Secure.ANDROID_ID
        )
        val id = if (androidId.isNullOrBlank()) UUID.randomUUID().toString() else androidId
        prefs.edit().putString(PREFS_KEY_DEVICE_ID, id).apply()
        return id
    }

    private fun computeFingerprint(pubKeyBytes: ByteArray): String {
        val md = MessageDigest.getInstance("SHA-256")
        return md.digest(pubKeyBytes).take(20).joinToString("") { "%02X".format(it) }
    }

    private fun buildDeviceRecord(deviceId: String, fingerprint: String): WritableMap {
        val map = Arguments.createMap()
        map.putInt("schemaVersion", 1)
        map.putString("platform", "android")
        map.putString("appScopedDeviceId", deviceId)
        map.putString("keyUserId", "device:$deviceId")
        map.putString("keyAlgorithm", "OpenPGP-ECDSA-P256")
        map.putString("publicKeyFingerprint", fingerprint)
        map.putString("publicKeyFile", "public_key.asc")
        return map
    }

    // ---- Minimal OpenPGP Packet Writer (RFC 4880) ----

    private fun writeOpenPGPPacketHeader(tag: Int, bodyLength: Int): ByteArray {
        val out = ByteArrayOutputStream()
        out.write((0x80 or (tag shl 2)))
        when {
            bodyLength < 192 -> out.write(bodyLength)
            bodyLength < 8384 -> {
                val len = bodyLength - 192
                out.write(192 + (len shr 8))
                out.write(len and 0xFF)
            }
            else -> {
                out.write(0xFF)
                val buf = ByteBuffer.allocate(4).putInt(bodyLength).array()
                out.write(buf)
            }
        }
        return out.toByteArray()
    }

    private fun writePublicKeyPacket(timestamp: Int, pubKeyEncoded: ByteArray): ByteArray {
        val out = ByteArrayOutputStream()
        // Version 4
        out.write(4)
        // Timestamp
        val ts = ByteBuffer.allocate(4).putInt(timestamp).array()
        out.write(ts)
        // Algorithm: ECDSA
        out.write(19) // OpenPGP-ECDSA (RFC 6637 compat)
        // Curve OID for NIST P-256
        val oid = byteArrayOf(0x2A.toByte(), 0x86.toByte(), 0x48.toByte(), 0xCE.toByte(), 0x3D.toByte(), 0x03.toByte(), 0x01.toByte(), 0x07.toByte())
        out.write(oid.size)
        out.write(oid)
        // EC point: uncompressed 0x04 || x || y
        if (pubKeyEncoded.size == 65 && pubKeyEncoded[0] == 0x04.toByte()) {
            out.write(pubKeyEncoded)
        } else {
            // Write as MPI
            val mpiOut = ByteArrayOutputStream()
            val bits = pubKeyEncoded.size * 8
            mpiOut.write(ByteBuffer.allocate(2).putShort(bits.toShort()).array())
            mpiOut.write(pubKeyEncoded)
            out.write(mpiOut.toByteArray())
        }
        val body = out.toByteArray()
        return writeOpenPGPPacketHeader(6, body.size) + body
    }

    private fun writeUserIDPacket(userID: String): ByteArray {
        val body = userID.toByteArray(Charsets.UTF_8)
        return writeOpenPGPPacketHeader(13, body.size) + body
    }

    private fun writeSignaturePacket(
        hashedData: ByteArray,
        rawSig: ByteArray,
        timestamp: Int
    ): ByteArray {
        val hash = MessageDigest.getInstance("SHA-256").digest(hashedData)

        val out = ByteArrayOutputStream()
        // Version 4
        out.write(4)
        // Sig type: 0x00 = binary document detached
        out.write(0)
        // Algorithm: ECDSA
        out.write(19)
        // Hash algorithm: SHA-256
        out.write(8)
        // Hashed subpackets length (0)
        out.write(ByteBuffer.allocate(2).putShort(0).array())
        // Unhashed subpackets length (0)
        out.write(ByteBuffer.allocate(2).putShort(0).array())
        // Hash prefix (first 2 bytes)
        out.write(hash.copyOfRange(0, 2))
        // ECDSA signature r || s
        out.write(rawSig)

        val body = out.toByteArray()
        return writeOpenPGPPacketHeader(2, body.size) + body
    }

    private fun asciiArmor(data: ByteArray, label: String): String {
        val sb = StringBuilder()
        sb.append("-----BEGIN PGP $label-----\n\n")

        val b64 = Base64.encodeToString(data, Base64.NO_WRAP)
        var pos = 0
        while (pos < b64.length) {
            val end = minOf(pos + 64, b64.length)
            sb.append(b64.substring(pos, end))
            sb.append("\n")
            pos = end
        }

        val crc = crc24(data)
        val crcB64 = crc24ToBase64(crc)
        sb.append("=$crcB64\n")
        sb.append("-----END PGP $label-----\n")
        return sb.toString()
    }

    private fun crc24(data: ByteArray): Int {
        val poly = 0x864CFB
        var crc = 0xB704CE
        for (b in data) {
            crc = crc xor ((b.toInt() and 0xFF) shl 16)
            for (i in 0 until 8) {
                crc = crc shl 1
                if ((crc and 0x1000000) != 0) {
                    crc = crc xor poly
                }
            }
        }
        return crc and 0xFFFFFF
    }

    private fun crc24ToBase64(crc: Int): String {
        val alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
        val chars = CharArray(4)
        var v = crc
        for (i in 3 downTo 0) {
            chars[i] = alphabet[v and 0x3F]
            v = v shr 6
        }
        return String(chars)
    }
}
