# GroundPin GitHub 云构建计划 — MacBook Neo 本机只保留代码

> 目标：MacBook Neo 本机不安装 Xcode、不安装 Android Studio、不安装 Android SDK、不安装 Node/Ruby/JDK 作为开发必需项。  
> 本机只保留源码、Git、编辑器；iOS/Android 构建、测试、打包、验证全部交给 GitHub Actions。  
> 项目：GroundPin  
> 日期：2026-06-01

---

## 一、核心结论

GroundPin 采用 GitHub Actions 云构建：

```text
MacBook Neo
  只写代码 / git commit / git push
      ↓
GitHub Repository
      ↓
GitHub Actions
  - Ubuntu runner 构建 Android
  - macOS runner 构建 iOS
      ↓
Artifacts
  - Android debug APK / release APK or AAB
  - iOS simulator app / signed IPA
  - logs
  - verification reports
```

本机不再要求：

```text
Xcode
Android Studio
Android SDK
Node
Ruby
CocoaPods
JDK
Watchman
GnuPG
```

本机最低要求：

```text
Git
SSH key or GitHub CLI
代码编辑器
浏览器
```

如果连 Git 都不想装，也可以用 GitHub Web Editor / Codespaces，但推荐至少保留 Git。

---

## 二、构建分层

### 1. 日常 PR / Push 验证

每次 push 或 pull request：

```text
- npm ci
- TypeScript 检查
- ESLint
- 单元测试
- Android debug build
- iOS simulator build
- GroundPin 证据包 verify 脚本测试
```

产物：

```text
- Android debug APK
- iOS simulator .app 或 build log
- test report
```

不需要 Apple 签名。

---

### 2. Android 云构建

Android 使用 GitHub Ubuntu runner：

```text
runs-on: ubuntu-latest
```

需要：

```text
Node 24
JDK 17
Android SDK / Gradle
项目自带 gradlew
```

产物：

```text
debug:
  app-debug.apk

release:
  app-release.apk 或 app-release.aab
```

release 签名需要 GitHub Secrets 保存 keystore。

---

### 3. iOS 云构建

iOS 使用 GitHub macOS runner：

```text
runs-on: macos-26
```

或保守：

```text
runs-on: macos-15
```

日常阶段先构建 iOS simulator：

```text
- npm ci
- bundle install
- cd ios && bundle exec pod install
- xcodebuild -workspace ... -scheme ... -sdk iphonesimulator ...
```

产物：

```text
GroundPin.app for simulator
```

不需要 Apple Developer 签名。

上线阶段再加 signed IPA：

```text
- Apple Developer certificate
- provisioning profile
- App Store Connect API key
- xcodebuild archive
- xcodebuild -exportArchive
```

---

## 三、本机环境

MacBook Neo 本机只需要：

```bash
git --version
```

推荐安装：

```bash
brew install git gh
```

但不是构建必需项。

不需要安装：

```bash
Xcode
Android Studio
Android SDK
Node
Ruby
CocoaPods
JDK
Watchman
GnuPG
```

本机 workflow：

```bash
git clone git@github.com:<owner>/GroundPin.git
cd GroundPin

# 修改代码
git add .
git commit -m "Update GroundPin"
git push
```

然后去 GitHub Actions 页面看构建结果并下载 artifacts。

---

## 四、仓库结构

```text
GroundPin/
  .github/
    workflows/
      ci.yml
      android-debug.yml
      android-release.yml
      ios-simulator.yml
      ios-release.yml
  tools/
    verify.sh
  package.json
  package-lock.json
  Gemfile
  Gemfile.lock
  ios/
  android/
  src/
```

---

## 五、基础配置文件

### 5.1 package.json

项目必须固定关键命令：

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test": "jest",
    "android:debug": "cd android && ./gradlew assembleDebug",
    "android:release": "cd android && ./gradlew assembleRelease",
    "ios:pods": "cd ios && bundle exec pod install",
    "verify:tools": "bash tools/verify.sh --self-test"
  }
}
```

### 5.2 Gemfile

CocoaPods 不在本机跑，但 CI 需要：

```ruby
source "https://rubygems.org"

gem "cocoapods", "~> 1.16"
gem "xcodeproj"
```

### 5.3 tools/verify.sh

GroundPin 证据包验证脚本必须在 CI 跑自测。

建议支持：

```bash
tools/verify.sh path/to/groundpin_attendance.zip
tools/verify.sh --self-test
```

---

## 六、GitHub Actions：CI 总入口

`.github/workflows/ci.yml`

```yaml
name: CI

on:
  pull_request:
  push:
    branches:
      - main
      - develop

permissions:
  contents: read

jobs:
  js-checks:
    name: JS / TS Checks
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: TypeScript
        run: npm run typecheck --if-present

      - name: Lint
        run: npm run lint --if-present

      - name: Test
        run: npm test --if-present

      - name: Verify script self-test
        run: |
          if [ -f tools/verify.sh ]; then
            bash tools/verify.sh --self-test || true
          fi
```

---

## 七、Android Debug Build

`.github/workflows/android-debug.yml`

```yaml
name: Android Debug Build

on:
  pull_request:
  push:
    branches:
      - main
      - develop
  workflow_dispatch:

permissions:
  contents: read

jobs:
  android-debug:
    name: Build Android Debug APK
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm

      - name: Setup JDK 17
        uses: actions/setup-java@v4
        with:
          distribution: zulu
          java-version: 17

      - name: Setup Gradle
        uses: gradle/actions/setup-gradle@v4

      - name: Install JS dependencies
        run: npm ci

      - name: Make gradlew executable
        run: chmod +x android/gradlew

      - name: Build debug APK
        run: cd android && ./gradlew assembleDebug --stacktrace

      - name: Upload debug APK
        uses: actions/upload-artifact@v4
        with:
          name: groundpin-android-debug-apk
          path: android/app/build/outputs/apk/debug/*.apk
          if-no-files-found: error
```

---

## 八、Android Release Build

`.github/workflows/android-release.yml`

```yaml
name: Android Release Build

on:
  workflow_dispatch:
  push:
    tags:
      - "v*"

permissions:
  contents: read

jobs:
  android-release:
    name: Build Android Release
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm

      - name: Setup JDK 17
        uses: actions/setup-java@v4
        with:
          distribution: zulu
          java-version: 17

      - name: Setup Gradle
        uses: gradle/actions/setup-gradle@v4

      - name: Install JS dependencies
        run: npm ci

      - name: Decode Android keystore
        if: ${{ secrets.ANDROID_KEYSTORE_BASE64 != '' }}
        run: |
          echo "${{ secrets.ANDROID_KEYSTORE_BASE64 }}" | base64 --decode > android/app/release.keystore

      - name: Build release APK
        env:
          ANDROID_KEYSTORE_FILE: release.keystore
          ANDROID_KEYSTORE_PASSWORD: ${{ secrets.ANDROID_KEYSTORE_PASSWORD }}
          ANDROID_KEY_ALIAS: ${{ secrets.ANDROID_KEY_ALIAS }}
          ANDROID_KEY_PASSWORD: ${{ secrets.ANDROID_KEY_PASSWORD }}
        run: |
          chmod +x android/gradlew
          cd android
          ./gradlew assembleRelease --stacktrace

      - name: Upload release APK
        uses: actions/upload-artifact@v4
        with:
          name: groundpin-android-release-apk
          path: android/app/build/outputs/apk/release/*.apk
          if-no-files-found: error
```

需要的 GitHub Secrets：

```text
ANDROID_KEYSTORE_BASE64
ANDROID_KEYSTORE_PASSWORD
ANDROID_KEY_ALIAS
ANDROID_KEY_PASSWORD
```

如果暂时不上架，可先只用 debug APK，不配置 release secrets。

---

## 九、iOS Simulator Build

`.github/workflows/ios-simulator.yml`

```yaml
name: iOS Simulator Build

on:
  pull_request:
  push:
    branches:
      - main
      - develop
  workflow_dispatch:

permissions:
  contents: read

jobs:
  ios-simulator:
    name: Build iOS Simulator App
    runs-on: macos-26

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Show Xcode version
        run: |
          xcodebuild -version
          xcode-select -p
          xcrun simctl list runtimes

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm

      - name: Setup Ruby
        uses: ruby/setup-ruby@v1
        with:
          ruby-version: "3.3"
          bundler-cache: true

      - name: Install JS dependencies
        run: npm ci

      - name: Install Pods
        run: cd ios && bundle exec pod install

      - name: Build iOS simulator
        run: |
          set -euo pipefail
          xcodebuild             -workspace ios/GroundPin.xcworkspace             -scheme GroundPin             -configuration Debug             -sdk iphonesimulator             -derivedDataPath build/ios             CODE_SIGNING_ALLOWED=NO             build

      - name: Upload iOS build folder
        uses: actions/upload-artifact@v4
        with:
          name: groundpin-ios-simulator-build
          path: build/ios/Build/Products/Debug-iphonesimulator/
          if-no-files-found: warn
```

说明：

```text
- 不需要本机 Xcode。
- 不需要 Apple Developer 账号。
- 只能产出 simulator build，不能直接装到真机。
```

---

## 十、iOS Signed IPA Release

`.github/workflows/ios-release.yml`

```yaml
name: iOS Signed IPA Release

on:
  workflow_dispatch:
  push:
    tags:
      - "v*"

permissions:
  contents: read

jobs:
  ios-release:
    name: Build signed iOS IPA
    runs-on: macos-26

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Show Xcode version
        run: xcodebuild -version

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm

      - name: Setup Ruby
        uses: ruby/setup-ruby@v1
        with:
          ruby-version: "3.3"
          bundler-cache: true

      - name: Install JS dependencies
        run: npm ci

      - name: Install Pods
        run: cd ios && bundle exec pod install

      - name: Import Apple signing certificate
        env:
          IOS_CERTIFICATE_P12_BASE64: ${{ secrets.IOS_CERTIFICATE_P12_BASE64 }}
          IOS_CERTIFICATE_PASSWORD: ${{ secrets.IOS_CERTIFICATE_PASSWORD }}
          KEYCHAIN_PASSWORD: ${{ secrets.IOS_KEYCHAIN_PASSWORD }}
        run: |
          set -euo pipefail

          CERT_PATH="$RUNNER_TEMP/certificate.p12"
          KEYCHAIN_PATH="$RUNNER_TEMP/app-signing.keychain-db"

          echo "$IOS_CERTIFICATE_P12_BASE64" | base64 --decode > "$CERT_PATH"

          security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
          security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
          security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"

          security import "$CERT_PATH"             -P "$IOS_CERTIFICATE_PASSWORD"             -A             -t cert             -f pkcs12             -k "$KEYCHAIN_PATH"

          security list-keychain -d user -s "$KEYCHAIN_PATH"
          security default-keychain -s "$KEYCHAIN_PATH"
          security set-key-partition-list -S apple-tool:,apple: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"

      - name: Install provisioning profile
        env:
          IOS_PROVISIONING_PROFILE_BASE64: ${{ secrets.IOS_PROVISIONING_PROFILE_BASE64 }}
        run: |
          set -euo pipefail

          mkdir -p "$HOME/Library/MobileDevice/Provisioning Profiles"
          PROFILE_PATH="$HOME/Library/MobileDevice/Provisioning Profiles/GroundPin.mobileprovision"
          echo "$IOS_PROVISIONING_PROFILE_BASE64" | base64 --decode > "$PROFILE_PATH"

      - name: Archive
        run: |
          set -euo pipefail

          xcodebuild             -workspace ios/GroundPin.xcworkspace             -scheme GroundPin             -configuration Release             -archivePath "$RUNNER_TEMP/GroundPin.xcarchive"             archive

      - name: Export IPA
        run: |
          set -euo pipefail

          cat > "$RUNNER_TEMP/ExportOptions.plist" <<'PLIST'
          <?xml version="1.0" encoding="UTF-8"?>
          <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
            "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
          <plist version="1.0">
          <dict>
            <key>method</key>
            <string>ad-hoc</string>
            <key>signingStyle</key>
            <string>manual</string>
            <key>stripSwiftSymbols</key>
            <true/>
            <key>compileBitcode</key>
            <false/>
          </dict>
          </plist>
          PLIST

          xcodebuild             -exportArchive             -archivePath "$RUNNER_TEMP/GroundPin.xcarchive"             -exportOptionsPlist "$RUNNER_TEMP/ExportOptions.plist"             -exportPath "$RUNNER_TEMP/export"

      - name: Upload IPA
        uses: actions/upload-artifact@v4
        with:
          name: groundpin-ios-ipa
          path: ${{ runner.temp }}/export/*.ipa
          if-no-files-found: error
```

需要的 GitHub Secrets：

```text
IOS_CERTIFICATE_P12_BASE64
IOS_CERTIFICATE_PASSWORD
IOS_PROVISIONING_PROFILE_BASE64
IOS_KEYCHAIN_PASSWORD
```

后续接 TestFlight 时，再增加：

```text
APP_STORE_CONNECT_API_KEY_ID
APP_STORE_CONNECT_API_ISSUER_ID
APP_STORE_CONNECT_API_KEY_P8_BASE64
```

---

## 十一、GroundPin 证据包验证 CI

`.github/workflows/groundpin-verify.yml`

```yaml
name: GroundPin Evidence Verify

on:
  pull_request:
  push:
    branches:
      - main
      - develop
  workflow_dispatch:

permissions:
  contents: read

jobs:
  verify-tools:
    name: Verify GroundPin Evidence Tools
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Install GnuPG and unzip
        run: |
          sudo apt-get update
          sudo apt-get install -y gnupg unzip

      - name: Run verify self-test
        run: |
          chmod +x tools/verify.sh
          ./tools/verify.sh --self-test
```

---

## 十二、GitHub Secrets 配置

进入：

```text
GitHub Repo
→ Settings
→ Secrets and variables
→ Actions
```

### Android release 可选 secrets

```text
ANDROID_KEYSTORE_BASE64
ANDROID_KEYSTORE_PASSWORD
ANDROID_KEY_ALIAS
ANDROID_KEY_PASSWORD
```

### iOS release 可选 secrets

```text
IOS_CERTIFICATE_P12_BASE64
IOS_CERTIFICATE_PASSWORD
IOS_PROVISIONING_PROFILE_BASE64
IOS_KEYCHAIN_PASSWORD
```

### 后续 TestFlight secrets

```text
APP_STORE_CONNECT_API_KEY_ID
APP_STORE_CONNECT_API_ISSUER_ID
APP_STORE_CONNECT_API_KEY_P8_BASE64
```

安全规则：

```text
- 不要把 .p12、.mobileprovision、keystore、.p8 提交到 repo
- 不要在日志里 echo 明文 secret
- GitHub Actions permissions 默认最小化
- pull_request from fork 不允许跑带签名 secrets 的 release workflow
```

---

## 十三、Artifacts 下载流程

1. 打开 GitHub repo。
2. 进入 Actions。
3. 点击对应 workflow run。
4. 在 Artifacts 区域下载：
   - `groundpin-android-debug-apk`
   - `groundpin-android-release-apk`
   - `groundpin-ios-simulator-build`
   - `groundpin-ios-ipa`

---

## 十四、分阶段落地

### Phase 1：本机只有代码 + 云端基础验证

目标：

```text
- GitHub repo 建立
- CI 能跑 npm ci / typecheck / lint / test
- Android debug APK 能产出
- iOS simulator build 能产出
```

不需要：

```text
Apple Developer Program
Android release keystore
iOS signing
TestFlight
```

### Phase 2：GroundPin App 功能开发

目标：

```text
- 定位五元组
- 三态按钮
- 附件
- anchor JSON
- hashes.txt
- sig.gpg
- zip
- verify.sh
```

CI 目标：

```text
- Android debug APK 每次可下载
- iOS simulator build 每次可下载
- verify.sh 自测通过
```

### Phase 3：Android release

目标：

```text
- 配置 Android keystore secrets
- 生成 signed APK/AAB
```

### Phase 4：iOS signed IPA

目标：

```text
- Apple Developer 账号
- 创建 App ID
- 创建 certificate
- 创建 provisioning profile
- 配置 GitHub Secrets
- 生成 signed IPA
```

### Phase 5：TestFlight / App Store

目标：

```text
- App Store Connect API key
- 自动上传 TestFlight
- 版本号自动递增
- release notes
```

---

## 十五、MacBook Neo 本机最终状态

本机只需要：

```text
Git repo
源码
编辑器
浏览器
```

本机不需要：

```text
Xcode
Command Line Tools
Android Studio
Android SDK
Node
Ruby
CocoaPods
JDK
GnuPG
Watchman
```

如果需要更舒适：

```text
GitHub CLI
VS Code
```

但不作为构建必需项。

---

## 十六、已知限制

1. iOS 真机安装和 TestFlight 仍然需要 Apple Developer 账号和签名。
2. 没有本地 Xcode，就不能本地跑 iOS Simulator。
3. 没有本地 Android SDK，就不能本地跑 Android emulator 或 adb 真机调试。
4. 本机只能写代码，不能本地验证原生模块行为。
5. 原生模块调试会依赖 GitHub Actions 日志，反馈循环比本地慢。
6. 相机、定位、录音等真机能力不能完全靠云端模拟，需要最终真机安装验证。
7. iOS simulator build 不等于真机可安装 IPA。
8. Android debug APK 可以直接下载装到 Android 真机，但需要允许安装未知来源应用。

---

## 十七、推荐策略

对 GroundPin 来说，推荐路线是：

```text
本机：
  只写代码 + git push

GitHub Actions：
  PR: JS/TS checks + Android debug + iOS simulator
  main: 同上
  tag v*: Android release + iOS signed IPA

早期：
  先不要接 signing
  先保证 debug/simulator build 通

中期：
  Android signed APK

后期：
  iOS signed IPA + TestFlight
```

---

## 十八、一句话结论

MacBook Neo 可以做到真正“本机只有代码”。  
GroundPin 的 iOS/Android 构建全部交给 GitHub Actions：

```text
Android = Ubuntu runner
iOS = macOS runner
产物 = GitHub Artifacts
签名材料 = GitHub Secrets
```

本机不装 Xcode，也不装 Android Studio。
