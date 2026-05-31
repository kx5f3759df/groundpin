package com.groundpin

import android.Manifest
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.os.SystemClock
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.*

class GroundPinLocationModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private var locationManager: LocationManager? = null
    private var latestLocation: Location? = null

    override fun getName(): String = "GroundPinLocation"

    override fun initialize() {
        super.initialize()
        locationManager = reactApplicationContext.getSystemService(android.content.Context.LOCATION_SERVICE) as LocationManager
    }

    @ReactMethod
    fun requestLocationPermission(promise: Promise) {
        val activity = currentActivity
        if (activity == null) {
            promise.resolve(false)
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val granted = ContextCompat.checkSelfPermission(activity, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            if (!granted) {
                activity.requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION), 1001)
            }
            promise.resolve(granted)
        } else {
            promise.resolve(true)
        }
    }

    @ReactMethod
    fun startLocationUpdates(input: ReadableMap, promise: Promise) {
        try {
            val intervalMs = input.getInt("intervalMs")
            locationManager?.requestLocationUpdates(
                LocationManager.GPS_PROVIDER,
                intervalMs.toLong(),
                0f,
                locationListener
            )
            promise.resolve(null)
        } catch (e: SecurityException) {
            promise.reject("PERMISSION", "Location permission not granted", e)
        } catch (e: Exception) {
            promise.reject("LOCATION_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun stopLocationUpdates(promise: Promise) {
        try {
            locationManager?.removeUpdates(locationListener)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("LOCATION_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun getCurrentLocationSnapshot(promise: Promise) {
        val loc = latestLocation
        if (loc == null) {
            promise.resolve(null)
            return
        }
        promise.resolve(locationToMap(loc))
    }

    @ReactMethod
    fun getCurrentMonotonicMs(promise: Promise) {
        promise.resolve(SystemClock.elapsedRealtime().toDouble())
    }

    private val locationListener = android.location.LocationListener { location ->
        latestLocation = location
    }

    @Suppress("DEPRECATION")
    private fun locationToMap(loc: Location): WritableMap {
        val map = Arguments.createMap()
        map.putDouble("latitude", loc.latitude)
        map.putDouble("longitude", loc.longitude)
        map.putDouble("horizontalAccuracyMeters", loc.accuracy.toDouble())
        map.putDouble("locationTimestampUnixMs", loc.time.toDouble())

        // Monotonic timestamp
        val elapsedMs: Long = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR1) {
            loc.elapsedRealtimeNanos / 1_000_000
        } else {
            SystemClock.elapsedRealtime()
        }
        map.putDouble("monotonicTimestampMs", elapsedMs.toDouble())

        // Age
        val ageMs = SystemClock.elapsedRealtime() - elapsedMs
        map.putDouble("ageMsAtReceive", ageMs.toDouble())

        // Source
        val source = Arguments.createMap()
        source.putString("platform", "android")
        source.putString("provider", loc.provider ?: "unknown")
        source.putBoolean("androidIsMock", loc.isFromMockProvider)
        map.putMap("source", source)

        // Accuracy authorization
        val hasFine = ContextCompat.checkSelfPermission(reactApplicationContext, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        map.putString("accuracyAuthorization", if (hasFine) "precise" else "approximate")

        // ID
        val id = "fix_${loc.time}${(Math.random() * 10000).toInt()}"
        map.putString("id", id)

        // Validation placeholders (JS side validates)
        map.putBoolean("isValid", false)
        map.putArray("invalidReasons", Arguments.createArray())
        map.putArray("riskFlags", Arguments.createArray())

        return map
    }
}
