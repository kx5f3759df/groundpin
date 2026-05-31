import CoreLocation
import Foundation

/// Emitted when a new location fix is available.
/// The JS side polls via getCurrentLocationSnapshot().
@objc(GroundPinLocation)
class GroundPinLocation: RCTEventEmitter, CLLocationManagerDelegate {

  private var locationManager: CLLocationManager?
  private var latestLocation: CLLocation?
  private var latestLocationTimestamp: Date?
  private var accuracyAuth: CLAccuracyAuthorization = .fullAccuracy
  private var hasListeners = false

  override init() {
    super.init()
    locationManager = CLLocationManager()
    locationManager?.delegate = self
    locationManager?.desiredAccuracy = kCLLocationAccuracyBestForNavigation
  }

  // MARK: - RCTEventEmitter

  override func supportedEvents() -> [String] {
    return ["onLocationUpdate"]
  }

  override func startObserving() {
    hasListeners = true
  }

  override func stopObserving() {
    hasListeners = false
  }

  override static func requiresMainQueueSetup() -> Bool {
    return true
  }

  // MARK: - CLLocationManagerDelegate

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let location = locations.last else { return }
    latestLocation = location
    latestLocationTimestamp = Date()

    if #available(iOS 14.0, *) {
      accuracyAuth = manager.accuracyAuthorization
    }

    if hasListeners {
      sendEvent(withName: "onLocationUpdate", body: locationToDict(location))
    }
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    // Silently handle — JS side will see null from getCurrentLocationSnapshot
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    if #available(iOS 14.0, *) {
      accuracyAuth = manager.accuracyAuthorization
    }
  }

  // MARK: - Location Dictionary

  private func locationToDict(_ loc: CLLocation) -> [String: Any] {
    let sourceInfo = loc.sourceInformation
    let timestampMs = loc.timestamp.timeIntervalSince1970 * 1000
    let fixId = "fix_\(Int(timestampMs))_\(Int.random(in: 0..<10000))"
    var dict: [String: Any] = [
      "id": fixId,
      "latitude": loc.coordinate.latitude,
      "longitude": loc.coordinate.longitude,
      "horizontalAccuracyMeters": loc.horizontalAccuracy,
      "locationTimestampUnixMs": timestampMs,
      "monotonicTimestampMs": ProcessInfo.processInfo.systemUptime * 1000,
      "source": [
        "platform": "ios",
        "provider": "unknown",
        "iosSimulatedBySoftware": sourceInfo?.isSimulatedBySoftware ?? false,
        "iosProducedByAccessory": sourceInfo?.isProducedByAccessory ?? false,
      ],
      "accuracyAuthorization": accuracyAuthorizationString(),
      "ageMsAtReceive": 0,
      "isValid": false,
      "invalidReasons": [] as [String],
      "riskFlags": [] as [String],
    ]
    return dict
  }

  private func accuracyAuthorizationString() -> String {
    if #available(iOS 14.0, *) {
      switch accuracyAuth {
      case .fullAccuracy: return "precise"
      case .reducedAccuracy: return "approximate"
      @unknown default: return "unknown"
      }
    }
    return "precise"
  }

  // MARK: - Exported Methods

  /// Request when-in-use location permission.
  @objc(requestLocationPermission:rejecter:)
  func requestLocationPermission(
    _ resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      self.locationManager?.requestWhenInUseAuthorization()
      let status = self.locationManager?.authorizationStatus ?? .notDetermined
      let granted = (status == .authorizedWhenInUse || status == .authorizedAlways)
      resolve(granted)
    }
  }

  /// Start delivering location updates.
  @objc(startLocationUpdates:resolver:rejecter:)
  func startLocationUpdates(
    _ input: [String: Any],
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      self.locationManager?.startUpdatingLocation()
      resolve(nil)
    }
  }

  /// Stop location updates.
  @objc(stopLocationUpdates:rejecter:)
  func stopLocationUpdates(
    _ resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      self.locationManager?.stopUpdatingLocation()
      resolve(nil)
    }
  }

  /// Get the most recent location snapshot as a JS object, or null.
  @objc(getCurrentLocationSnapshot:rejecter:)
  func getCurrentLocationSnapshot(
    _ resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      if let loc = self.latestLocation {
        resolve(self.locationToDict(loc))
      } else {
        resolve(nil)
      }
    }
  }

  /// Get monotonic timestamp (systemUptime) in milliseconds.
  @objc(getCurrentMonotonicMs:rejecter:)
  func getCurrentMonotonicMs(
    _ resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    let ms = ProcessInfo.processInfo.systemUptime * 1000
    resolve(ms)
  }
}
