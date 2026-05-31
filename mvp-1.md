你是一个在 arm64 MacBook 上工作的资深移动端工程 agent。请实现一个可直接上线的最小 MVP，项目 code name 为 `GroundPin`。这是一个 React Native 裸工程，同时支持 iOS 和 Android 编译运行。不要使用 Expo。不要依赖 Google Play Services、Firebase、Play Integrity、App Attest、第三方定位 SDK、第三方相机 SDK、第三方录音 SDK、第三方云服务。底层能力通过 iOS Swift / Android Kotlin 原生模块实现。

项目目标：做一个“装修工人到场打卡证据包生成器”。App 不依赖后端，不登录，不联网。App 在本机获取定位五元组，首次启动生成设备密钥对，允许用户在有效定位后的 10 分钟内添加文字、录音、照片、视频附件。附件可以长期累计，允许跨度数天、数周甚至数个月，最后在当前 GNSS 有效时再生成打卡 zip 证据包。zip 内包含所有证据文件、每个附件对应的定位锚点 JSON、文件 hash 文本、公钥，以及一个标准 OpenPGP/GPG detached signature 文件 `sig.gpg`。导出时弹出系统分享/保存界面。

这不是 PoC，不允许用“看起来像 GPG”的自定义格式冒充 GPG。MVP 可以功能少，但已实现功能必须真实、稳定、可验证。

一、技术栈

1. React Native bare project。
2. iOS 使用 Swift 原生模块。
3. Android 使用 Kotlin 原生模块。
4. UI 使用 React Native。
5. 不使用 Expo。
6. Android 不使用 Google Play Services，因此定位必须使用 `android.location.LocationManager`，不要用 `FusedLocationProviderClient`。
7. iOS 定位使用 CoreLocation。
8. iOS 相机、视频、录音使用 AVFoundation 或系统标准 API。
9. Android 相机、视频、录音使用系统标准 API：

   * 录音：MediaRecorder。
   * 拍照/视频：系统 Camera Intent 或 Camera2，MVP 优先使用系统 Camera Intent，但必须确保文件由 App 创建并能被证据包收录。
10. 密钥：

* iOS 使用 Security framework / Keychain。
* Android 使用 Android Keystore。

11. Zip：

* Android 可用 `java.util.zip`。
* iOS 若没有系统 zip API，则实现最小 ZIP writer。
* zip 内路径和文件顺序必须稳定。

12. GPG/OpenPGP：

* 必须生成可被标准 `gpg` 验证的 detached signature。
* 验收命令必须成功：

  ```bash
  gpg --import public_key.asc
  gpg --verify sig.gpg hashes.txt
  ```
* 如果文件名叫 `sig.gpg`，但内容使用 ASCII armor，也可以接受；但验收仍以 `gpg --verify sig.gpg hashes.txt` 为准。
* 不允许输出自定义签名格式。
* 不允许 README 里写“这是 PGP-like”然后当作完成。
* 如果纯标准库无法完成 OpenPGP packet 生成，需要实现必要的最小 OpenPGP packet writer，或者明确说明该任务未完成，不得伪装通过。

二、产品定义

App 用于装修工人到达施工现场时生成本地证据包。证据包可分享给公司、客户、项目经理或后台系统后续验证。

核心用户流程：

1. 用户打开 App。
2. App 申请定位权限。
3. App 只在前台、App 可见、主界面显示时刷新 GNSS/定位。
4. App 每 1 秒请求或刷新一次定位状态。
5. App 进入后台、熄屏、不可见、非 active 状态时，停止定位刷新，以节约电量。
6. 定位当前无效，且最近 10 分钟内也没有有效定位锚点时，中间圆形按钮为红色，不能打卡，也不能添加附件。
7. 定位当前无效，但最近 10 分钟内存在有效定位锚点时，中间圆形按钮为黄色，不能打卡，但可以添加附件。
8. 定位当前有效时，中间圆形按钮为绿色，可以打卡，也可以添加附件。
9. 用户可以在允许添加附件的状态下添加：

   * 文字说明。
   * App 内录音。
   * App 内拍摄照片。
   * App 内拍摄视频。
10. 用户可以重复添加多个附件。
11. 每个附件创建时，必须同时保存该附件所采用的定位锚点五元组 JSON 文件。
12. 用户可以通过右上角附件图标查看和删除已添加附件。
13. 用户可以退出 App 后重新进入，之前添加的附件仍然保留。
14. App 重启后，附件保留，但“最近 10 分钟有效定位可添加附件”的窗口不从旧会话继承，必须等本次 App 可见运行期间重新获得有效定位锚点后，才允许继续添加新附件。
15. 附件允许长期累计。用户可以在数天、数周、数个月内多次进入 App，反复添加附件。最后只要当前定位有效，就可以生成包含所有未删除附件的打卡 zip 证据包。
16. 用户点击绿色打卡按钮后，App 生成 zip 证据包。
17. App 弹出系统导出/分享界面。

三、主按钮三态状态机

中间圆形按钮有三种状态：

1. 红色：无效状态。

   * 条件：当前没有有效定位，并且最近 10 分钟内没有有效定位锚点。
   * 文案：

     ```text
     无法打卡
     ```
   * 行为：

     * 点击不生成包。
     * 底部附件按钮禁用。
   * 提示：

     ```text
     等待有效 GNSS 定位
     ```

2. 黄色：附件状态。

   * 条件：当前定位无效，但最近 10 分钟内存在有效定位锚点。
   * 文案：

     ```text
     仅可添加附件
     ```
   * 行为：

     * 点击不生成打卡包。
     * 底部附件按钮启用。
   * 提示：

     ```text
     当前 GNSS 无效，但 10 分钟内有有效定位，只可添加附件
     ```

3. 绿色：打卡状态。

   * 条件：当前定位有效。
   * 文案：

     ```text
     打卡
     ```
   * 行为：

     * 点击生成 zip 证据包。
     * 底部附件按钮启用。
   * 提示：

     ```text
     定位有效，可以打卡
     ```

注意：

* 黄色状态不允许生成最终打卡包。
* 最终打卡必须要求“当前定位有效”，即绿色状态。
* 黄色状态只用于在短时间内继续添加现场附件。
* App 重启后，黄色状态不应因为旧附件存在而自动恢复。必须在本次前台会话中获得新的有效定位锚点后，才可能进入黄色状态。

四、定位刷新生命周期

App 的定位策略必须节约电量：

1. 只有在 App 处于前台 active 状态，并且主界面显示时，才启动定位刷新。
2. App 每 1 秒刷新一次 GNSS/定位状态。
3. App 进入后台时，立即停止定位。
4. App 熄屏、失去 active、进入 inactive/background 时，立即停止定位。
5. App 回到前台后，重新开始定位刷新。
6. 不申请后台定位权限。
7. 不做后台定位。
8. 不做持续轨迹记录。
9. 只保存最近少量定位用于有效性判断和速度跳变检测。

React Native 层使用 `AppState` 和 screen focus 状态控制：

* active + main screen focused => start location updates。
* inactive/background 或 main screen unfocused => stop location updates。

原生层也要防御：

* iOS 在 scene/app background 时停止 CLLocationManager updates。
* Android 在 Activity onPause/onStop 时停止 LocationManager updates。

五、定位五元组

每次定位需要标准化成以下结构：

```ts
export type LocationEvidence = {
  latitude: number;
  longitude: number;
  horizontalAccuracyMeters: number;
  locationTimestampUnixMs: number;
  locationSource: {
    platform: 'ios' | 'android';
    provider: 'gps' | 'network' | 'passive' | 'fused' | 'unknown';
    iosSimulatedBySoftware?: boolean;
    iosProducedByAccessory?: boolean;
    androidIsMock?: boolean;
  };
  accuracyAuthorization: 'precise' | 'approximate' | 'unknown';
};
```

字段说明：

1. 经纬度：

   * iOS：`CLLocation.coordinate.latitude / longitude`
   * Android：`Location.getLatitude() / getLongitude()`

2. 水平精度：

   * iOS：`CLLocation.horizontalAccuracy`
   * Android：`Location.getAccuracy()`

3. 定位时间：

   * iOS：`CLLocation.timestamp`
   * Android：`Location.getTime()`

4. 定位来源：

   * iOS：provider 填 `unknown`。
   * iOS 额外记录：

     * `CLLocation.sourceInformation?.isSimulatedBySoftware`
     * `CLLocation.sourceInformation?.isProducedByAccessory`
   * Android 记录：

     * `Location.getProvider()`
     * `Location.isMock`

5. 是否模糊定位：

   * iOS：

     * `CLLocationManager.accuracyAuthorization == .fullAccuracy` => `precise`
     * `reducedAccuracy` => `approximate`
   * Android：

     * 有 `ACCESS_FINE_LOCATION` 且系统返回 fine location => `precise`
     * 只有 coarse / approximate => `approximate`

六、本机时间不可信：EvidenceClock

假定设备 wall clock 不可靠。证据中的附件生成时间不能直接使用 `Date.now()` 或系统当前时间。

实现 EvidenceClock：

```ts
export type EvidenceClock = {
  anchorLocationFixId: string;
  anchorLocationTimestampUnixMs: number;
  anchorMonotonicMs: number;
};
```

当收到有效定位时：

1. 将该定位作为当前会话的时间 anchor。
2. 记录：

   * `anchorLocationTimestampUnixMs`
   * `anchorMonotonicMs`
3. 后续附件时间使用：

   ```ts
   evidenceTimeUnixMs =
     anchorLocationTimestampUnixMs + (currentMonotonicMs - anchorMonotonicMs)
   ```

平台要求：

iOS：

* 使用 `ProcessInfo.processInfo.systemUptime * 1000` 作为 monotonic ms。
* 定位 anchor 的 wall time 使用 `CLLocation.timestamp`。
* 附件时间用 `CLLocation.timestamp + monotonic delta` 推算。
* 不把设备当前 wall clock 写入证据作为证据时间。

Android：

* 使用 `Location.getElapsedRealtimeNanos() / 1_000_000` 作为定位 monotonic ms。
* 使用 `SystemClock.elapsedRealtime()` 作为当前 monotonic ms。
* 附件时间用 `Location.getTime() + monotonic delta` 推算。
* 不把设备当前 wall clock 写入证据作为证据时间。

规则：

1. 没有本次前台会话内的有效定位 anchor 时，不允许添加附件。
2. 最近有效定位 anchor 超过 10 分钟，不允许添加附件。
3. App 重启后，旧附件保留，但旧 EvidenceClock anchor 不用于允许添加新附件。
4. App 重启后必须重新获得有效定位 anchor，才能添加新附件。
5. 打卡包生成时间也使用当前有效定位对应的 EvidenceClock 推算，不直接使用设备 wall clock。
6. 附件可以长期累计，但每个附件必须保存自己创建时使用的 anchor 定位信息 JSON。

七、GNSS / 定位有效性

当前 MVP 暂时只使用本机定位做有效性判断，不使用服务端 nonce，不做客户确认。

定位有效规则：

通用规则：

1. 已获得定位权限。
2. 经纬度存在。
3. `horizontalAccuracyMeters > 0`。
4. `horizontalAccuracyMeters <= 100`。
5. 定位时间存在。
6. `accuracyAuthorization == precise`。
7. 最近定位必须足够新鲜。
8. 最近定位序列不能出现明显不可能的速度跳变。

常量：

```ts
export const LOCATION_REFRESH_INTERVAL_MS = 1_000;
export const LOCATION_MAX_ACCURACY_METERS = 100;
export const LOCATION_MAX_AGE_MS = 30_000;
export const ATTACHMENT_WINDOW_MS = 10 * 60 * 1000;
export const MAX_REASONABLE_SPEED_MPS = 80;
```

iOS 有效性：

1. `horizontalAccuracy > 0`。
2. `horizontalAccuracy <= 100`。
3. `accuracyAuthorization == fullAccuracy`。
4. `sourceInformation.isSimulatedBySoftware != true`。
5. `sourceInformation.isProducedByAccessory` 只记录为风险，不直接拒绝。
6. CoreLocation 没有 Android 那样可靠的 `elapsedRealtimeNanos`，因此：

   * 对刚从 delegate 收到的定位，age 视为 0。
   * 如果定位对象 timestamp 与当前系统时间差明显超过 30 秒，可拒绝为 stale，但不要把系统时间写入证据文件。
   * README 必须明确 iOS 对定位新鲜度判断存在平台限制。

Android 有效性：

1. 使用 `LocationManager.GPS_PROVIDER` 请求定位。
2. 不使用 Google fused provider。
3. `provider == gps`。
4. `isMock != true`。
5. `accuracyAuthorization == precise`。
6. `ageMs = SystemClock.elapsedRealtime() - location.elapsedRealtimeNanos / 1_000_000`
7. `ageMs <= 30_000`。
8. 如果只有 network provider，默认判无效，但记录到 `invalidReasons`。

速度跳变规则：

1. 保存最近 5 个候选定位。
2. 对相邻定位计算距离和时间差。
3. 如果速度大于 80 m/s，加入 `riskFlags: ["impossible_speed"]`，并判当前定位无效。

八、附件锚点定位 JSON

这是核心要求。

每次添加附件时，必须同时保存“该附件采用的锚点定位信息五元组”为 JSON 文件。

规则：

1. 附件使用当前可用的 EvidenceClock anchor。
2. 如果当前定位有效，附件锚点使用当前有效定位。
3. 如果当前定位无效，但最近 10 分钟内有有效定位 anchor，附件锚点使用最近那个有效定位 anchor。
4. 每个附件必须有一个同名 JSON 锚点文件。
5. “同名”定义为：和附件文件相同 basename，但扩展名为 `.json`。

   * `text_1710000000000_ab12.txt`
   * 对应 `text_1710000000000_ab12.json`
   * `audio_1710000001000_cd34.m4a`
   * 对应 `audio_1710000001000_cd34.json`
   * `photo_1710000002000_ef56.jpg`
   * 对应 `photo_1710000002000_ef56.json`
   * `video_1710000003000_gh78.mp4`
   * 对应 `video_1710000003000_gh78.json`
6. JSON 文件放在 `attachments/` 下，和附件文件同目录。
7. 删除附件时，必须同时删除对应锚点 JSON。
8. 生成 zip 时，附件文件和对应锚点 JSON 都必须进入 zip。
9. `hashes.txt` 必须包含附件文件和对应锚点 JSON 的 hash。
10. `manifest.json` 必须记录每个附件对应的 anchor JSON 文件路径。

附件锚点 JSON 示例：

```json
{
  "schemaVersion": 1,
  "attachmentId": "uuid",
  "attachmentFile": "attachments/photo_1710000002000_ef56.jpg",
  "anchorFile": "attachments/photo_1710000002000_ef56.json",
  "evidenceTimeUnixMs": 1710000002000,
  "sourceLocationFixId": "fix-uuid",
  "anchorLocation": {
    "latitude": 43.0,
    "longitude": -79.0,
    "horizontalAccuracyMeters": 12.5,
    "locationTimestampUnixMs": 1710000000000,
    "locationSource": {
      "platform": "android",
      "provider": "gps",
      "androidIsMock": false
    },
    "accuracyAuthorization": "precise"
  },
  "anchorValidation": {
    "isValidAtAnchorTime": true,
    "invalidReasons": [],
    "riskFlags": []
  },
  "timeDerivation": {
    "anchorLocationTimestampUnixMs": 1710000000000,
    "anchorMonotonicMs": 123456000,
    "attachmentMonotonicMs": 123458000,
    "deltaFromAnchorMs": 2000,
    "derivedEvidenceTimeUnixMs": 1710000002000
  }
}
```

九、附件长期累计和会话规则

附件生命周期：

1. 附件保存在 App 私有目录。
2. 附件 metadata 持久化保存。
3. App 退出再进入后，附件列表仍然存在。
4. 之前添加的附件不会因为 10 分钟窗口过期而消失。
5. 10 分钟窗口只控制“是否允许添加新附件”，不控制已有附件是否有效。
6. 用户可以在长时间跨度内累计附件。
7. 最终生成打卡包时，会包含所有未删除附件及其对应 anchor JSON。
8. 最终生成打卡包必须要求当前定位有效，即绿色状态。
9. 黄色状态只能添加附件，不能生成最终打卡包。
10. 红色状态不能添加附件，也不能生成最终打卡包。
11. App 重启后，旧附件保留，但 10 分钟窗口重置。必须获得新的有效定位 anchor 后才能添加新附件。
12. App 重启后，如果当前没有新有效定位，哪怕历史附件很多，也显示红色状态。

十、设备 ID 和密钥

首次启动 App 后生成设备密钥对。密钥 name / user id 使用设备 id。

设备 ID 定义为 appScopedDeviceId：

iOS：

1. 优先使用 `UIDevice.current.identifierForVendor?.uuidString`。
2. 如果为空，生成 UUID fallback。
3. 保存 fallback 到 Keychain。

Android：

1. 优先使用 `Settings.Secure.ANDROID_ID`。
2. 如果为空，生成 UUID fallback。
3. 保存 fallback 到 private app storage；如果实现加密存储更好。
4. 不采集 IMEI、序列号、手机号。

启动时流程：

1. 读取当前 appScopedDeviceId。
2. 读取 lastSeenDeviceId。
3. 如果 lastSeenDeviceId 不存在：

   * 保存当前 appScopedDeviceId。
   * 如果没有密钥，则生成密钥。
4. 如果 lastSeenDeviceId 与当前 appScopedDeviceId 一致：

   * 保留现有密钥。
5. 如果 lastSeenDeviceId 与当前 appScopedDeviceId 不一致：

   * 删除旧密钥。
   * 生成新密钥。
   * 更新 lastSeenDeviceId。
6. key user id：

   ```text
   device:<appScopedDeviceId>
   ```

密钥要求：

1. 优先使用 Ed25519 OpenPGP key。
2. 如果平台标准库不方便生成 Ed25519，则使用 ECDSA P-256，但生成的 OpenPGP public key 和 signature 必须能被 GnuPG 导入和验证。
3. 私钥必须存储在：

   * iOS Keychain。
   * Android Keystore。
4. 私钥不可导出。
5. 公钥必须导出为标准 OpenPGP public key block：

   ```text
   -----BEGIN PGP PUBLIC KEY BLOCK-----
   ...
   -----END PGP PUBLIC KEY BLOCK-----
   ```
6. `public_key.asc` 必须能被：

   ```bash
   gpg --import public_key.asc
   ```

   成功导入。

十一、GPG 签名定义

zip 内必须包含：

```text
hashes.txt
sig.gpg
public_key.asc
```

其中：

1. `hashes.txt` 是被签名文件。
2. `sig.gpg` 是对 `hashes.txt` 的 OpenPGP detached signature。
3. `public_key.asc` 是对应公钥。
4. 验证命令必须成功：

```bash
gpg --import public_key.asc
gpg --verify sig.gpg hashes.txt
```

`hashes.txt` 格式使用稳定、可读、易验证的 SHA-256 文本格式：

```text
SHA256  manifest.json  <hex>
SHA256  location.json  <hex>
SHA256  deviceRecord.json  <hex>
SHA256  public_key.asc  <hex>
SHA256  attachments/text_1710000000000_ab12.txt  <hex>
SHA256  attachments/text_1710000000000_ab12.json  <hex>
SHA256  attachments/audio_1710000001000_cd34.m4a  <hex>
SHA256  attachments/audio_1710000001000_cd34.json  <hex>
SHA256  attachments/photo_1710000002000_ef56.jpg  <hex>
SHA256  attachments/photo_1710000002000_ef56.json  <hex>
SHA256  attachments/video_1710000003000_gh78.mp4  <hex>
SHA256  attachments/video_1710000003000_gh78.json  <hex>
```

要求：

1. 每行格式严格为：

   ```text
   SHA256  <pathInZip>  <lowercaseHexHash>
   ```
2. 路径使用 `/`。
3. 路径不允许 `..`。
4. 路径按字典序排序。
5. `hashes.txt` 不包含自身 hash。
6. `hashes.txt` 不包含 `sig.gpg` 的 hash。
7. `hashes.txt` 必须包含 `public_key.asc` 的 hash。
8. `sig.gpg` 签名的字节必须是 `hashes.txt` 的 UTF-8 原始字节。
9. `sig.gpg` 可以是 binary detached signature，也可以是 ASCII armored detached signature。
10. 虽然文件名为 `sig.gpg`，如果使用 armor，文件内容应形如：

    ```text
    -----BEGIN PGP SIGNATURE-----
    ...
    -----END PGP SIGNATURE-----
    ```
11. 无论 binary 还是 armor，验收都以：

    ```bash
    gpg --verify sig.gpg hashes.txt
    ```

    成功为准。
12. 不允许使用自定义 JSON 签名代替 GPG。
13. 不允许把普通 ECDSA signature base64 包一层 `BEGIN PGP SIGNATURE` 冒充 OpenPGP。

十二、证据包 zip 结构

生成的 zip 命名：

```text
groundpin_attendance_<packageId>.zip
```

zip 内容：

```text
manifest.json
location.json
deviceRecord.json
hashes.txt
sig.gpg
public_key.asc
attachments/
  text_<evidenceTimeUnixMs>_<shortId>.txt
  text_<evidenceTimeUnixMs>_<shortId>.json
  audio_<evidenceTimeUnixMs>_<shortId>.m4a
  audio_<evidenceTimeUnixMs>_<shortId>.json
  photo_<evidenceTimeUnixMs>_<shortId>.jpg
  photo_<evidenceTimeUnixMs>_<shortId>.json
  video_<evidenceTimeUnixMs>_<shortId>.mp4
  video_<evidenceTimeUnixMs>_<shortId>.json
```

`manifest.json` 示例：

```json
{
  "schemaVersion": 1,
  "packageId": "uuid",
  "createdAtEvidenceTimeUnixMs": 1710000000000,
  "platform": "ios",
  "appVersion": "1.0.0",
  "device": {
    "appScopedDeviceId": "...",
    "keyUserId": "device:...",
    "publicKeyFingerprint": "...",
    "keyAlgorithm": "OpenPGP-Ed25519"
  },
  "finalCheckInLocation": {
    "file": "location.json"
  },
  "hashes": {
    "file": "hashes.txt",
    "signature": "sig.gpg",
    "publicKey": "public_key.asc"
  },
  "attachments": [
    {
      "id": "...",
      "type": "photo",
      "file": "attachments/photo_1710000002000_ef56.jpg",
      "anchorFile": "attachments/photo_1710000002000_ef56.json",
      "mimeType": "image/jpeg",
      "evidenceTimeUnixMs": 1710000002000,
      "sourceLocationFixId": "..."
    }
  ]
}
```

`location.json` 表示最终打卡时的当前有效定位：

```json
{
  "schemaVersion": 1,
  "selectedFix": {
    "id": "...",
    "latitude": 43.0,
    "longitude": -79.0,
    "horizontalAccuracyMeters": 12.5,
    "locationTimestampUnixMs": 1710000000000,
    "monotonicTimestampMs": 123456789,
    "locationSource": {
      "platform": "android",
      "provider": "gps",
      "androidIsMock": false
    },
    "accuracyAuthorization": "precise",
    "isValid": true,
    "invalidReasons": [],
    "riskFlags": []
  },
  "recentFixes": [],
  "validation": {
    "isValid": true,
    "rulesetVersion": 1,
    "maxAccuracyMeters": 100,
    "maxAgeMs": 30000,
    "maxReasonableSpeedMps": 80
  }
}
```

`deviceRecord.json` 示例：

```json
{
  "schemaVersion": 1,
  "platform": "ios",
  "appScopedDeviceId": "...",
  "keyUserId": "device:...",
  "keyAlgorithm": "OpenPGP-Ed25519",
  "publicKeyFingerprint": "...",
  "publicKeyFile": "public_key.asc"
}
```

十三、附件功能

底部有三个按钮：

1. 文字。
2. 录音。
3. 拍照/视频。

启用条件：

1. 当前绿色状态，或黄色状态。
2. 即最近 10 分钟内存在本次前台会话内获得的有效定位 anchor。
3. EvidenceClock anchor 有效。
4. 相关权限已授权。

文字附件：

1. 弹出文本输入框。
2. 保存为 UTF-8 `.txt`。
3. 文件名：

   ```text
   text_<evidenceTimeUnixMs>_<shortId>.txt
   ```
4. 同时生成：

   ```text
   text_<evidenceTimeUnixMs>_<shortId>.json
   ```

录音附件：

1. App 内录音。
2. 输出 `.m4a`。
3. iOS 使用 AVAudioRecorder。
4. Android 使用 MediaRecorder：

   * OutputFormat.MPEG_4
   * AudioEncoder.AAC
5. 文件名：

   ```text
   audio_<evidenceTimeUnixMs>_<shortId>.m4a
   ```
6. 同时生成：

   ```text
   audio_<evidenceTimeUnixMs>_<shortId>.json
   ```

照片附件：

1. 只能 App 内拍摄。
2. 不允许从相册选择。
3. 输出 `.jpg`。
4. 文件名：

   ```text
   photo_<evidenceTimeUnixMs>_<shortId>.jpg
   ```
5. 同时生成：

   ```text
   photo_<evidenceTimeUnixMs>_<shortId>.json
   ```

视频附件：

1. 只能 App 内拍摄。
2. 不允许从相册选择。
3. 输出 `.mp4`。
4. 文件名：

   ```text
   video_<evidenceTimeUnixMs>_<shortId>.mp4
   ```
5. 同时生成：

   ```text
   video_<evidenceTimeUnixMs>_<shortId>.json
   ```

附件记录结构：

```ts
export type AttachmentRecord = {
  id: string;
  type: 'text' | 'audio' | 'photo' | 'video';
  filename: string;
  anchorFilename: string;
  pathInZip: string;
  anchorPathInZip: string;
  uri: string;
  anchorJsonUri: string;
  mimeType: string;
  sizeBytes: number;
  anchorJsonSizeBytes: number;
  evidenceTimeUnixMs: number;
  sourceLocationFixId: string;
};
```

删除规则：

1. 右上角附件图标显示附件数量。
2. 点击进入附件列表。
3. 附件列表展示：

   * 类型。
   * 文件名。
   * anchor JSON 文件名。
   * evidenceTimeUnixMs。
   * 大小。
4. 用户可以删除附件。
5. 删除附件时，必须同时删除对应 anchor JSON。
6. 已删除附件和 anchor JSON 不得出现在 zip、manifest、hashes.txt 中。

十四、UI 要求

主界面：

1. 极简界面。
2. 中间一个大圆形按钮。
3. 红色表示无效，无法打卡，也不能添加附件。
4. 黄色表示当前不能打卡，只能添加附件。
5. 绿色表示当前有效，可以打卡，也可以添加附件。
6. 红色按钮文字：

   ```text
   无法打卡
   ```
7. 黄色按钮文字：

   ```text
   仅可添加附件
   ```
8. 绿色按钮文字：

   ```text
   打卡
   ```
9. 按钮下方显示当前状态，例如：

   * 等待有效 GNSS 定位
   * 定位精度 18m，可以打卡
   * 当前 GNSS 无效，但 10 分钟内有有效定位，只可添加附件
   * 模糊定位，无法打卡
   * 疑似模拟定位，无法打卡
   * 定位过旧，无法打卡
   * 非 GPS provider，无法打卡
10. 底部三个按钮：

* 文字
* 录音
* 拍照/视频

11. 底部按钮只在黄色或绿色状态启用。
12. 右上角附件图标：

* 显示当前附件数量。
* 点击打开附件列表。

13. 附件列表里展示已有附件，即使 App 重启后也应保留。
14. 权限未授权时显示清晰提示。
15. 不需要地图。
16. 不需要登录。
17. 不需要设置页，但需要有基本错误提示。

十五、React Native TypeScript 接口

请实现或等价实现以下接口：

```ts
export type PlatformName = 'ios' | 'android';

export type AccuracyAuthorization =
  | 'precise'
  | 'approximate'
  | 'unknown';

export type LocationProvider =
  | 'gps'
  | 'network'
  | 'passive'
  | 'fused'
  | 'unknown';

export type LocationSource = {
  platform: PlatformName;
  provider: LocationProvider;
  iosSimulatedBySoftware?: boolean;
  iosProducedByAccessory?: boolean;
  androidIsMock?: boolean;
};

export type LocationFix = {
  id: string;
  latitude: number;
  longitude: number;
  horizontalAccuracyMeters: number;
  locationTimestampUnixMs: number;
  monotonicTimestampMs: number;
  source: LocationSource;
  accuracyAuthorization: AccuracyAuthorization;
  ageMsAtReceive: number;
  isValid: boolean;
  invalidReasons: string[];
  riskFlags: string[];
};

export type EvidenceClock = {
  anchorLocationFixId: string;
  anchorLocationTimestampUnixMs: number;
  anchorMonotonicMs: number;
};

export type EvidenceTime = {
  evidenceTimeUnixMs: number;
  anchorLocationFixId: string;
  anchorLocationTimestampUnixMs: number;
  deltaFromAnchorMs: number;
};

export type ButtonState = 'red_invalid' | 'yellow_attachment_only' | 'green_check_in';

export type DeviceRecord = {
  schemaVersion: 1;
  platform: PlatformName;
  appScopedDeviceId: string;
  keyUserId: string;
  keyAlgorithm: string;
  publicKeyFingerprint: string;
  publicKeyFile: 'public_key.asc';
};

export type AttachmentRecord = {
  id: string;
  type: 'text' | 'audio' | 'photo' | 'video';
  filename: string;
  anchorFilename: string;
  pathInZip: string;
  anchorPathInZip: string;
  uri: string;
  anchorJsonUri: string;
  mimeType: string;
  sizeBytes: number;
  anchorJsonSizeBytes: number;
  evidenceTimeUnixMs: number;
  sourceLocationFixId: string;
};

export interface NativeLocationModule {
  requestLocationPermission(): Promise<boolean>;
  startLocationUpdates(input: { intervalMs: number }): Promise<void>;
  stopLocationUpdates(): Promise<void>;
  getCurrentLocationSnapshot(): Promise<LocationFix | null>;
  getCurrentMonotonicMs(): Promise<number>;
}

export interface NativeDeviceKeyModule {
  initializeOrRotateDeviceKey(): Promise<DeviceRecord>;
  exportPublicKeyAsc(): Promise<string>;
  signHashesTxtDetachedGpg(input: {
    hashesTxtUtf8: string;
    armor: boolean;
  }): Promise<{
    signatureUri: string;
    signatureFileName: 'sig.gpg';
    isArmored: boolean;
  }>;
}

export interface NativeMediaModule {
  recordAudioM4a(input: {
    evidenceTimeUnixMs: number;
    sourceLocationFixId: string;
  }): Promise<AttachmentRecord>;

  capturePhotoJpg(input: {
    evidenceTimeUnixMs: number;
    sourceLocationFixId: string;
  }): Promise<AttachmentRecord>;

  captureVideoMp4(input: {
    evidenceTimeUnixMs: number;
    sourceLocationFixId: string;
  }): Promise<AttachmentRecord>;
}

export interface NativePackageModule {
  sha256File(uri: string): Promise<string>;

  writeUtf8File(input: {
    filename: string;
    utf8Content: string;
  }): Promise<{ uri: string; sizeBytes: number }>;

  createZipPackage(input: {
    packageId: string;
    files: Array<{
      pathInZip: string;
      uri: string;
    }>;
  }): Promise<{
    zipUri: string;
    sizeBytes: number;
  }>;

  shareFile(input: {
    uri: string;
    mimeType: string;
    title: string;
  }): Promise<void>;
}
```

十六、iOS 原生实现要点

Location：

1. 使用 `CLLocationManager`。
2. `desiredAccuracy = kCLLocationAccuracyBestForNavigation` 或 `kCLLocationAccuracyBest`。
3. 申请 When In Use 权限。
4. 不申请 Always 权限。
5. 不做后台定位。
6. 主界面 active 时启动定位。
7. 主界面不可见、App inactive/background 时停止定位。
8. 每 1 秒刷新定位状态。
9. 监听 `didUpdateLocations`。
10. 只使用最新定位。
11. 读取：

* latitude
* longitude
* horizontalAccuracy
* timestamp
* sourceInformation
* accuracyAuthorization

12. provider 填 `unknown`。
13. monotonic 使用 `ProcessInfo.processInfo.systemUptime * 1000`。
14. reduced accuracy 直接判无效。
15. simulated by software 直接判无效。
16. produced by accessory 记录 risk flag。

Media：

1. 录音使用 AVAudioRecorder，输出 m4a/AAC。
2. 拍照/视频可用 UIImagePickerController camera source；若实现 AVFoundation 更好。
3. 不允许从相册选择。
4. 文件保存到 App 私有 Documents 或 Caches 目录。
5. 不写入系统相册。

Key / GPG：

1. 私钥保存在 Keychain。
2. 公钥导出为标准 OpenPGP public key block。
3. `sig.gpg` 必须是标准 OpenPGP detached signature。
4. README 必须给出真机上生成的证据包如何用 `gpg --verify` 验证。
5. 如果 iOS Security framework 原生 key 无法直接产出 OpenPGP key packet，需要实现 OpenPGP key packet 和 signature packet 的必要编码，不能降级为自定义格式。

Share：

1. 使用 `UIActivityViewController` 导出 zip。
2. 导出失败要显示错误。

十七、Android 原生实现要点

Location：

1. 使用 `LocationManager`。
2. 请求 `ACCESS_FINE_LOCATION`。
3. 不使用 Google Fused Provider。
4. 使用 `GPS_PROVIDER` 请求定位。
5. 不做后台定位。
6. Activity onResume 且主界面显示时启动定位。
7. Activity onPause/onStop 时停止定位。
8. 每 1 秒刷新定位状态。
9. 读取：

   * latitude
   * longitude
   * accuracy
   * time
   * elapsedRealtimeNanos
   * provider
   * isMock
10. `provider != gps` 默认无效。
11. `isMock == true` 无效。
12. `ageMs > 30000` 无效。
13. 只有 coarse / approximate location 时无效。

Media：

1. 录音使用 MediaRecorder。
2. 输出 m4a：

   * OutputFormat.MPEG_4
   * AudioEncoder.AAC
3. 拍照/视频可使用系统 Intent。
4. 使用 FileProvider。
5. 文件保存到 App 私有目录。
6. 不写入公共相册，除非用户导出 zip。

Key / GPG：

1. 私钥保存在 Android Keystore。
2. alias 包含 appScopedDeviceId。
3. appScopedDeviceId 改变时删除旧 alias 并生成新 key。
4. 公钥导出为标准 OpenPGP public key block。
5. `sig.gpg` 必须是标准 OpenPGP detached signature。
6. 验收必须能通过：

   ```bash
   gpg --import public_key.asc
   gpg --verify sig.gpg hashes.txt
   ```

Zip / Share：

1. Zip 使用 `java.util.zip.ZipOutputStream`。
2. zip 内文件路径稳定。
3. 使用 FileProvider + ACTION_SEND + chooser 分享 zip。

十八、hash 生成

生成 zip 前，先准备所有文件：

1. `manifest.json`
2. `location.json`
3. `deviceRecord.json`
4. `public_key.asc`
5. 所有附件文件。
6. 所有附件对应 anchor JSON 文件。

然后计算 SHA-256。

生成 `hashes.txt`，格式如下：

```text
SHA256  attachments/photo_1710000002000_abcd.jpg  ...
SHA256  attachments/photo_1710000002000_abcd.json  ...
SHA256  deviceRecord.json  e3b0c44298fc1c149afbf4c8996fb924...
SHA256  location.json  2cf24dba5fb0a30e26e83b2ac5b9e29e...
SHA256  manifest.json  486ea46224d1bb4fb680f34f7c9ad96a...
SHA256  public_key.asc  9f86d081884c7d659a2feaa0c55ad015...
```

要求：

1. lowercase hex。
2. UTF-8。
3. LF 换行。
4. 文件路径字典序排序。
5. 最后一行可以有 LF，但必须固定；推荐总是以 LF 结尾。
6. 对 `hashes.txt` 的完整 UTF-8 字节生成 `sig.gpg` detached signature。

十九、签名和验证脚本

repo 中必须提供一个验证脚本或验证说明。

至少提供 `tools/verify.sh`：

```bash
#!/usr/bin/env bash
set -euo pipefail

ZIP_PATH="$1"
WORKDIR="$(mktemp -d)"

unzip "$ZIP_PATH" -d "$WORKDIR"

cd "$WORKDIR"

gpg --import public_key.asc
gpg --verify sig.gpg hashes.txt

while read -r alg path hex; do
  if [ "$alg" != "SHA256" ]; then
    echo "Unsupported hash algorithm: $alg"
    exit 1
  fi

  actual="$(shasum -a 256 "$path" | awk '{print $1}')"

  if [ "$actual" != "$hex" ]; then
    echo "Hash mismatch: $path"
    echo "expected: $hex"
    echo "actual:   $actual"
    exit 1
  fi
done < hashes.txt

echo "OK"
```

如果 `hashes.txt` 的格式使用不同分隔方式，请同步调整脚本。

二十、错误处理要求

上线 MVP 不能静默失败。以下情况必须有明确 UI 提示：

1. 定位权限未授权。
2. 精确定位未开启。
3. 定位过旧。
4. 定位精度太差。
5. 疑似模拟定位。
6. Android 非 GPS provider。
7. 没有本次会话有效定位 anchor，不能添加附件。
8. 最近有效定位 anchor 超过 10 分钟，不能添加附件。
9. 黄色状态下不能打卡，只能添加附件。
10. 红色状态下不能打卡，也不能添加附件。
11. 相机权限未授权。
12. 麦克风权限未授权。
13. 录音失败。
14. 拍照失败。
15. 视频失败。
16. 附件 anchor JSON 生成失败。
17. 密钥生成失败。
18. 公钥导出失败。
19. GPG 签名失败。
20. hash 失败。
21. zip 失败。
22. 分享/导出失败。
23. 定位刷新启动失败。
24. 定位刷新停止失败。

二十一、隐私和数据边界

1. App 不联网。
2. App 不上传任何数据。
3. App 不读取相册。
4. App 不读取通讯录。
5. App 不扫描 Wi-Fi。
6. App 不扫描 BLE。
7. App 不采集 IMEI、手机号、序列号。
8. App 只使用 appScopedDeviceId：

   * iOS IDFV 或 fallback UUID。
   * Android ANDROID_ID 或 fallback UUID。
9. 附件只存本 App 私有目录，除非用户主动导出 zip。
10. App 只在前台可见时定位。
11. App 不申请后台定位权限。
12. README 必须说明证据包可能包含照片、音频、视频和位置，用户分享前应确认内容。

二十二、README 必须包含

1. 项目目标。
2. 安装依赖。
3. iOS 运行：

   ```bash
   npm install
   cd ios
   pod install
   cd ..
   npx react-native run-ios
   ```
4. Android 运行：

   ```bash
   npm install
   npx react-native run-android
   ```
5. 真机测试说明。
6. 权限说明。
7. 定位生命周期说明：

   * 只在前台、App 可见、主界面显示时每秒刷新。
   * 后台、熄屏、不可见时停止定位。
   * 不申请后台定位。
8. 三态按钮说明：

   * 红色：不能打卡，不能添加附件。
   * 黄色：不能打卡，只能添加附件。
   * 绿色：可以打卡，可以添加附件。
9. 附件长期累计说明：

   * 附件可跨天、跨周、跨月保留。
   * App 重启后附件仍在。
   * App 重启后 10 分钟添加窗口不从旧会话继承，必须重新获得有效定位。
   * 每个附件都有对应 anchor JSON。
10. iOS 平台限制：

    * iOS 不暴露 raw GNSS。
    * iOS 不暴露 GPS/Wi-Fi/蜂窝 provider 细分类。
    * iOS 定位新鲜度判断无法像 Android 一样完全基于 Location monotonic timestamp。
11. Android 平台限制：

    * 不使用 Google fused provider。
    * 只接受 GPS provider 可能导致室内较难打卡。
12. 时间模型说明：

    * 设备 wall clock 不可信。
    * 附件时间由定位时间 anchor + monotonic delta 推算。
13. GPG 验证说明：

    ```bash
    unzip groundpin_attendance_xxx.zip -d out
    cd out
    gpg --import public_key.asc
    gpg --verify sig.gpg hashes.txt
    shasum -a 256 ...
    ```
14. `tools/verify.sh` 使用方式。
15. 安全边界：

    * 这是本地证据包 MVP，不是最终反作弊系统。
    * 没有服务端 nonce，不能防止所有重放。
    * 没有客户确认，不能证明客户认可到场。
    * 没有设备完整性，不能防止所有 Root/Jailbreak/Hook。
    * 但可以证明 zip 内文件未被修改，且 `hashes.txt` 由本设备密钥对应的 OpenPGP 私钥签名。
    * 每个附件都有自己的定位锚点 JSON，可用于事后审计附件是在什么定位锚点下创建的。

二十三、目录结构

请交付完整 repo：

```text
GroundPin/
  package.json
  README.md
  tools/
    verify.sh
  src/
    App.tsx
    screens/
      MainScreen.tsx
      AttachmentsScreen.tsx
    native/
      NativeLocation.ts
      NativeDeviceKey.ts
      NativeMedia.ts
      NativePackage.ts
    utils/
      evidenceClock.ts
      locationValidation.ts
      hashesTxt.ts
      ids.ts
      fileNames.ts
      anchorJson.ts
      appStateLocationController.ts
    storage/
      attachmentStore.ts
      deviceStore.ts
  ios/
  android/
```

二十四、上线 MVP 验收标准

必须全部满足：

1. iOS 真机可运行。
2. Android 真机可运行。
3. App 只在前台可见主界面每 1 秒刷新定位。
4. App 后台、熄屏、不可见时停止定位。
5. App 不申请后台定位权限。
6. 首次启动生成 appScopedDeviceId。
7. 首次启动生成设备 OpenPGP 密钥。
8. 再次启动 device id 不变时，不重新生成密钥。
9. device id 改变时，删除旧密钥并生成新密钥。
10. `public_key.asc` 可被 `gpg --import`。
11. 当前定位无效且 10 分钟内无有效 anchor 时，主按钮红色。
12. 当前定位无效但 10 分钟内有有效 anchor 时，主按钮黄色。
13. 当前定位有效时，主按钮绿色。
14. 红色状态不能打卡，不能添加附件。
15. 黄色状态不能打卡，只能添加附件。
16. 绿色状态可以打卡，可以添加附件。
17. iOS reduced accuracy 时不能打卡。
18. Android approximate/coarse location 时不能打卡。
19. Android mock location 时不能打卡。
20. Android 非 GPS provider 默认不能打卡。
21. horizontalAccuracy > 100m 时不能打卡。
22. 定位过旧时不能打卡。
23. 最近 10 分钟内有有效定位 anchor 时，可以添加文字。
24. 最近 10 分钟内有有效定位 anchor 时，可以录音 m4a。
25. 最近 10 分钟内有有效定位 anchor 时，可以拍照 jpg。
26. 最近 10 分钟内有有效定位 anchor 时，可以录视频 mp4。
27. 附件可以重复添加。
28. 附件可以删除。
29. 删除附件时，对应 anchor JSON 也被删除。
30. 删除后的附件和 anchor JSON 不进入 zip。
31. 每个附件都有同 basename 的 `.json` 定位锚点文件。
32. 附件 anchor JSON 包含定位五元组。
33. 附件 anchor JSON 包含 timeDerivation 信息。
34. 附件 evidenceTimeUnixMs 由定位 anchor + monotonic delta 推算，不直接使用 Date.now。
35. App 退出再进入后，历史附件仍在。
36. App 退出再进入后，旧附件仍可被最终打包。
37. App 退出再进入后，不能因为历史附件存在而允许添加新附件；必须重新获得有效定位 anchor。
38. 附件允许长期累计，最终包包含所有未删除附件。
39. 点击绿色打卡按钮生成 zip。
40. 黄色状态点击主按钮不会生成 zip，并提示“当前只可添加附件，打卡需要当前 GNSS 有效”。
41. zip 包含：

    * manifest.json
    * location.json
    * deviceRecord.json
    * hashes.txt
    * sig.gpg
    * public_key.asc
    * attachments/
42. zip 中每个附件都有对应 anchor JSON。
43. `hashes.txt` 包含所有被签名证据文件的 SHA-256，包括所有附件和 anchor JSON。
44. `sig.gpg` 是 `hashes.txt` 的标准 OpenPGP detached signature。
45. 以下命令成功：

    ```bash
    gpg --import public_key.asc
    gpg --verify sig.gpg hashes.txt
    ```
46. `tools/verify.sh groundpin_attendance_xxx.zip` 成功。
47. 系统分享/导出界面弹出。
48. README 不得把未完成的 GPG 兼容说成已完成。
49. App 不联网。
50. App 不依赖 Google Play Services。
51. App 不使用 Expo。
52. App 不从相册选择已有照片/视频。
53. App 权限和失败状态都有明确 UI 提示。

二十五、实现优先级

请按以下顺序实现：

1. React Native 基础 UI。
2. 三态按钮状态机。
3. AppState/screen focus 控制定位生命周期。
4. iOS/Android 定位模块。
5. 每 1 秒前台定位刷新。
6. 定位有效性判断。
7. EvidenceClock。
8. 附件持久化 storage。
9. 附件 anchor JSON 生成。
10. 设备 ID 与密钥生命周期。
11. OpenPGP public key 导出。
12. `hashes.txt` 生成。
13. `sig.gpg` detached signature。
14. zip 生成。
15. `tools/verify.sh`。
16. 系统分享。
17. 文字附件。
18. 录音附件。
19. 拍照附件。
20. 视频附件。
21. README 和真机验收。

最重要的不可妥协点：

1. 不要做 PoC 签名格式。
2. 不要伪造 PGP armor。
3. 不要把普通 base64 signature 叫做 `sig.gpg`。
4. `gpg --verify sig.gpg hashes.txt` 必须成功。
5. 如果做不到标准 GPG 验证，就明确标记任务未完成，不要提交成完成状态。
6. 每个附件必须有对应定位锚点 JSON。
7. App 重启后附件保留，但 10 分钟添加窗口必须重新获得有效定位后才开启。
8. App 只在前台可见时定位，后台和熄屏不定位。
9. 黄色状态只允许添加附件，不允许最终打卡。
