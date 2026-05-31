# Project Instructions

This file provides context for AI assistants working on this project.

## Project Type

GroundPin — React Native bare project (no Expo). A "construction worker on-site check-in evidence package generator." No backend, no login, no network. Runs on iOS (Swift native modules) and Android (Kotlin native modules). 

Build/test commands:

```bash
npm ci
npm run typecheck     # tsc --noEmit
npm run lint          # eslint
npm test              # jest
npm run android:debug # cd android && ./gradlew assembleDebug
npm run android:release
npm run ios:pods      # cd ios && bundle exec pod install
npm run verify:tools  # bash tools/verify.sh --self-test
```

### Version Control
This project uses Git. See .gitignore for excluded files.

## Agent Guidance

- **CodeWhale reads this file as:** AGENTS.md (CodeWhale-native)
- **Read-only surface:** `.github/workflows/` CI definitions, `tools/verify.sh` verification script — treat these as infrastructure, not application code. Read to understand, don't modify unless the task explicitly targets CI.
- **Never edit:** `package-lock.json`, `Gemfile.lock`, `ios/Pods/`, `android/.gradle/`, generated native project boilerplate in `ios/` and `android/` unless necessary for native module integration.
- **Always test with:** `npm run typecheck && npm run lint` for JS/TS changes; `npm run android:debug` for Android build verification; `bash tools/verify.sh --self-test` for evidence package integrity.

### Approach

1. **Platform parity.** Every feature must work on both iOS and Android through React Native + native module bridges. When implementing a native module, implement both Swift (iOS) and Kotlin (Android) sides, exposing the same TypeScript interface.
2. **No network.** This app must never make network requests. No imports of remote resources, no analytics, no crash reporting SDKs.
3. **No Google Play Services.** On Android, use `android.location.LocationManager` (never `FusedLocationProviderClient`), `MediaRecorder` for audio, system Camera Intent or Camera2 for photos/video. Do not import Play Services, Firebase, or any Google-proprietary SDK.
4. **Evidence integrity.** Every attachment must have a corresponding anchor JSON with the location quintuple. Time must use EvidenceClock (location timestamp + monotonic delta), never `Date.now()` or device wall clock. GPG signatures must be verifiable by standard `gpg --verify`.
5. **Cloud-first build.** MacBook Neo has no Xcode, no Android Studio, no Node/Ruby/JDK installed locally. All builds happen on GitHub Actions. Local development only writes code; verification runs in CI.

### Key invariants (do not break these)

- App only refreshes location when foreground + main screen visible, every 1 second. Stops immediately on background/inactive.
- No background location permission is ever requested.
- Attachments persist across app restarts and can accumulate over days/weeks/months.
- The 10-minute attachment window never survives an app restart — must reacquire a valid location fix.
- Yellow state (recent valid anchor but current GPS invalid) allows attachments only, never final check-in.
- Green state (current GPS valid) is the only state that generates the final evidence zip.
- `sig.gpg` must be a real OpenPGP detached signature verifiable with `gpg --verify sig.gpg hashes.txt`.
- Every attachment deletion must also delete its corresponding anchor JSON.
- `hashes.txt` uses dictionary-sorted paths, does not include itself or `sig.gpg`, but includes `public_key.asc`.

## Architecture

### Entry Points
- `src/App.tsx` — React Native root component.
- `src/screens/MainScreen.tsx` — Main UI with the tri-state button, attachment controls, and location status.
- `src/screens/AttachmentsScreen.tsx` — Attachment list with delete capability.
- Native module entry points: `ios/GroundPin/` (Swift) and `android/app/src/main/java/.../` (Kotlin).

### Key Modules
- `src/native/NativeLocation.ts` — TypeScript bridge to iOS CoreLocation / Android LocationManager.
- `src/native/NativeDeviceKey.ts` — TypeScript bridge to iOS Keychain / Android Keystore for OpenPGP key generation.
- `src/native/NativeMedia.ts` — TypeScript bridge to camera, audio recording, video capture.
- `src/native/NativePackage.ts` — TypeScript bridge to zip creation and system share sheet.
- `src/utils/evidenceClock.ts` — EvidenceClock: derives attachment times from location timestamp + monotonic delta.
- `src/utils/locationValidation.ts` — Location validity checks (accuracy, age, provider, mock detection, speed sanity).
- `src/utils/hashesTxt.ts` — `hashes.txt` generator with SHA-256, sorted paths, strict formatting.
- `src/storage/attachmentStore.ts` — Persistent attachment records with anchor JSON pairing.

### Data Flow
1. **Location:** Native module → 1s foreground polling → `LocationFix` type → JS validation → tri-state button logic.
2. **Attachment creation:** User taps media button → native capture → file saved to app-private storage → anchor JSON generated with EvidenceClock-derived timestamp → attachment record persisted.
3. **Check-in package:** User taps green button → all undeleted attachments + anchor JSONs + `manifest.json` + `location.json` + `deviceRecord.json` + `public_key.asc` collected → SHA-256 hashes computed → `hashes.txt` written → OpenPGP detached signature generated → zip created → system share sheet.

## Cache Stability

- **Frequently-rebuilt files:** `package-lock.json`, `Gemfile.lock`, `ios/Pods/`, `android/.gradle/`, `android/app/build/`.
- **Stable scaffolding:** `AGENTS.md`, `package.json` (scripts section), `tools/verify.sh`, `.github/workflows/*.yml`, `src/utils/*.ts` (algorithm code), TypeScript type definitions.
- **Append, don't reorder:** When adding new CI jobs or new utility modules, append to existing files. Avoid reordering `hashes.txt` generation logic or evidence format definitions — byte stability matters for verification reproducibility.

## Guidelines

- Follow existing TypeScript patterns: const enums, branded types where appropriate, exhaustive switch on union types.
- Native modules must expose Promise-based async interfaces; avoid callbacks in the bridge layer.
- Every native module method must handle permission denied, hardware unavailable, and unexpected null returns gracefully — surface errors to JS as structured error objects, never crash.
- Write tests for pure utility functions (location validation, evidence clock, hash text formatting, file name generation).
- Keep changes focused and atomic — a single commit should not mix UI refactors with native module changes.
- Document native module APIs with JSDoc on the TypeScript side and inline comments on the Swift/Kotlin side.
- Update this file when project conventions change or new invariants are established.
- The target README.md must explain: project goal, install steps, iOS/Android run commands, permission requirements, location lifecycle, tri-state button behavior, attachment accumulation rules, GPG verification steps, platform limitations, and security boundaries.
