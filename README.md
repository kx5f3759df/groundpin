# GroundPin — 到场打卡证据包生成器

纯本地、无后端、无登录的到场打卡证据包生成器。不依赖网络，不采集用户数据。支持 iOS 和 Android。

## 项目目标

在施工现场或其他需要到场证明的场景下，生成本地证据包（ZIP）。证据包包含定位信息、媒体附件、SHA-256 哈希以及 OpenPGP 数字签名，可供公司、客户或后台系统后续验证。

## 安装依赖

```bash
git clone <repo-url>
cd GroundPin
npm ci
```

## iOS 运行

```bash
npm ci
cd ios
bundle install
bundle exec pod install
cd ..
npx react-native run-ios
```

需要 Xcode 和 CocoaPods。真机测试需要在 Xcode 中配置签名。

## Android 运行

```bash
npm ci
npx react-native run-android
```

需要 Android SDK 和 JDK 17。真机安装需允许「未知来源」应用。

## 构建命令

```bash
npm run typecheck     # TypeScript 类型检查
npm run lint          # ESLint
npm test              # Jest 单元测试
npm run android:debug # Android Debug APK
npm run android:release  # Android Release APK
npm run ios:pods      # iOS CocoaPods 安装
npm run verify:tools  # 验证脚本自测
```

## 权限说明

App 会申请以下权限：

| 权限 | 用途 | 说明 |
|------|------|------|
| 定位（仅使用时） | 获取 GNSS 定位五元组 | 不申请后台定位 |
| 相机 | App 内拍照/录视频 | 不访问相册 |
| 麦克风 | App 内录音 | 仅在主动录音时使用 |

## 定位生命周期

- **只在前台、App 可见、主界面显示时每 1 秒刷新定位**
- **后台、熄屏、不可见时立即停止定位**
- **不申请后台定位权限**
- 不做持续轨迹记录
- 只保存最近少量定位用于有效性判断和速度跳变检测

## 三态按钮说明

中间圆形按钮有三种状态：

| 颜色 | 状态 | 打卡 | 添加附件 | 条件 |
|------|------|------|----------|------|
| 红色 | 无效 | 否 | 否 | 当前无有效定位，且 10 分钟内无有效锚点 |
| 黄色 | 附件 | 否 | 是 | 当前定位无效，但 10 分钟内有有效锚点 |
| 绿色 | 可打卡 | 是 | 是 | 当前定位有效 |

### 定位有效规则

- 水平精度 ≤ 100m
- 定位新鲜度 ≤ 30 秒
- 精确定位（非模糊/近似定位）
- Android：GPS provider、非模拟定位
- iOS：非软件模拟定位
- 无不可能的速度跳变（> 80 m/s）

## 附件说明

### 附件类型

- **文字** — 用户输入的文本说明（.txt）
- **录音** — App 内录音（.m4a, AAC）
- **照片** — App 内拍照（.jpg）
- **视频** — App 内拍摄视频（.mp4）

### 附件长期累计

- 附件可跨天、跨周、跨月保留
- App 重启后附件仍在
- App 重启后 10 分钟添加窗口不从旧会话继承——必须重新获得有效定位后才允许添加新附件
- 每个附件都有对应的定位锚点 JSON（同名 .json 文件）
- 最终打卡包包含所有未删除附件及其锚点 JSON

## 时间模型

**设备 wall clock 不可信。** 附件时间由定位锚点 GPS 时间 + monotonic delta 推算：

```
evidenceTime = anchorLocationTimestamp + (currentMonotonic - anchorMonotonic)
```

- iOS：使用 `ProcessInfo.processInfo.systemUptime * 1000` 作为 monotonic 时间
- Android：使用 `SystemClock.elapsedRealtime()` 作为 monotonic 时间
- 不把设备当前 wall clock 写入证据文件

## 证据包结构

生成的 ZIP 文件命名：`groundpin_attendance_<packageId>.zip`

```
manifest.json          # 包元数据
location.json          # 最终打卡定位
deviceRecord.json      # 设备记录
hashes.txt             # SHA-256 文件清单
sig.gpg                # OpenPGP detached 签名
public_key.asc         # 设备公钥
attachments/
  text_xxx_xxxx.txt    # 文字附件
  text_xxx_xxxx.json   # 对应锚点 JSON
  audio_xxx_xxxx.m4a
  audio_xxx_xxxx.json
  photo_xxx_xxxx.jpg
  photo_xxx_xxxx.json
  video_xxx_xxxx.mp4
  video_xxx_xxxx.json
```

## GPG 验证

```bash
unzip groundpin_attendance_xxx.zip -d out
cd out
gpg --import public_key.asc
gpg --verify sig.gpg hashes.txt
shasum -a 256 <path>
```

或使用项目自带的验证脚本：
```bash
bash tools/verify.sh path/to/groundpin_attendance_xxx.zip
bash tools/verify.sh --self-test
```

验证脚本会：
1. 解压 ZIP
2. 导入公钥
3. 验证 `gpg --verify sig.gpg hashes.txt`
4. 逐行验证 `hashes.txt` 中的 SHA-256 哈希

## 密钥算法

使用 ECDSA P-256（OpenPGP-ECDSA-P256），密钥存储在：
- iOS Keychain
- Android Keystore

私钥不可导出。公钥导出为标准 ASCII-armored OpenPGP 格式。

设备 ID 使用 `device:<appScopedDeviceId>` 格式。iOS 使用 IDFV，Android 使用 ANDROID_ID（均有 UUID fallback）。

## 平台限制

### iOS

- 不暴露 raw GNSS
- 不暴露 GPS/Wi-Fi/蜂窝 provider 细分类（provider 统一为 `unknown`）
- 定位新鲜度判断无法像 Android 一样完全基于 monotonic timestamp——对刚收到的定位 age 视为 0
- `sourceInformation.isProducedByAccessory` 仅记录为风险标记，不拒绝

### Android

- 不使用 Google fused provider
- 只接受 GPS provider（`provider == "gps"`），可能导致室内较难打卡
- 使用 `LocationManager.GPS_PROVIDER` 请求定位

## 安全边界

这是本地证据包 MVP：
- 没有服务端 nonce，不能防止所有重放
- 没有客户确认，不能证明客户认可到场
- 没有设备完整性，不能防止所有 Root/Jailbreak/Hook
- **但可以证明 zip 内文件未被修改**
- **`hashes.txt` 由本设备 OpenPGP 私钥签名**
- **每个附件都有自己的定位锚点 JSON，可用于事后审计**

## 隐私和数据

- App 不联网
- App 不上传任何数据
- App 不读取相册
- App 不读取通讯录
- App 不扫描 Wi-Fi / BLE
- App 不采集 IMEI、手机号、序列号
- 附件只存本 App 私有目录，除非用户主动导出 ZIP
- 分享 ZIP 前请确认内容（可能包含照片、音频、视频和位置信息）
