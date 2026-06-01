# Project Instructions

This file provides context for AI assistants working on this project.

## Project Type

GroundPin — React Native bare project (no Expo). A "construction worker on-site check-in evidence package generator." No backend, no login, no network. Runs on iOS (Swift native modules) and Android (Kotlin native modules).

### Version Control

This project uses Git. See `.gitignore` for excluded files.

GitHub CLI (`gh`) is available and authenticated as **kx5f3759df** (scopes: `repo`, `workflow`, `read:org`, `gist`). Use `gh` for issue/PR management, workflow runs, artifact download, and repo operations — no manual token handling needed.

---

## Local Machine Policy (HARD RULE)

**The developer machine (MacBook Neo) is code-only.** Agents must follow this unless the user explicitly overrides it in the current message.

### Allowed locally

| Action | Notes |
|--------|--------|
| Edit source, config, workflows | TS/Swift/Kotlin, `package.json`, `.github/workflows/*`, etc. |
| `git status` / `diff` / `log` / `commit` / `push` | Version control only |
| `gh run list`, `gh run view`, `gh run download` | Read CI status and artifacts — **primary debug channel** |
| `npm install --package-lock-only` | **Only** when `package.json` deps change; must **not** create `node_modules/` |

### Forbidden locally (never run)

```text
npm ci / npm install          # except --package-lock-only above
brew install / gem install
./gradlew / gradle
pod install / bundle install
java / javac / android studio
xcodebuild / xcode-select
docker pull (for build env)
```

Do **not** create or leave behind: `node_modules/`, `ios/Pods/`, `android/.gradle/`, `android/app/build/`, `~/.gradle` caches from project builds.

If verification is needed, **push and read GitHub Actions** — do not "just run it locally once."

Full cloud-build rationale and runner specs: `docs/GroundPin_GitHub_cloud_build_plan_MacBook_Neo.md`.

---

## CI Debug Workflow (default for agents)

This is the approved loop used to fix Android/iOS builds without local tooling:

```text
1. Read failure logs
     gh run list --limit 8
     gh run view <run-id> --log-failed

2. Edit code / workflow (minimal diff)

3. Update lockfile if package.json changed
     npm install --package-lock-only --no-audit --no-fund
     (confirm: no node_modules/ created)

4. git commit && git push origin main

5. Wait for workflows on the same commit, then re-check
     gh run list --limit 8
```

**Workflows triggered on push to `main` / `develop` / PR:**

| Workflow | Runner | What it proves |
|----------|--------|----------------|
| `CI` | ubuntu | `npm ci`, typecheck, lint, jest |
| `GroundPin Evidence Verify` | ubuntu | `tools/verify.sh --self-test` |
| `Android Debug Build` | ubuntu | `./gradlew assembleDebug` → artifact `groundpin-android-debug-apk` |
| `iOS Simulator Build` | macos-15 | `pod install`, xcodebuild simulator → artifact `groundpin-ios-simulator-build` |

Release workflows (`android-release.yml`, `ios-release.yml`) run on demand or tag; they require signing secrets.

**Download debug APK after green Android build:**

```bash
gh run list --workflow="Android Debug Build" --limit 1
gh run download <run-id> -n groundpin-android-debug-apk -D ./apk-out
# → apk-out/app-debug.apk
```

**Pre-release (main only):** successful `Android Debug Build` on `main` auto-updates GitHub pre-release tag `v<package.json version>-pre` (e.g. `v1.0.0-pre`) with the latest debug APK. Download: `https://github.com/kx5f3759df/groundpin/releases` — no local `gh run download` needed.

Or open the run page → **Artifacts** at the bottom (90-day retention).

**When CI logs are insufficient:** ask the user to paste the failed step log, or use `gh run view --log-failed` (requires `gh` auth with workflow read).

---

## Agent Guidance

- **CodeWhale reads this file as:** AGENTS.md (CodeWhale-native)
- **Read-only surface:** `.github/workflows/` CI definitions, `tools/verify.sh` — treat as infrastructure; read to understand, don't modify unless the task targets CI.
- **Never edit:** `package-lock.json` by hand (regenerate via `--package-lock-only`), `Gemfile.lock`, `ios/Pods/`, `android/.gradle/`, generated native boilerplate in `ios/` and `android/` unless required for native module integration.
- **Verify JS/TS changes in CI:** push triggers `CI` (typecheck + lint + test). Do not run `npm run typecheck` locally unless user explicitly allows local Node.
- **Verify native builds in CI:** push triggers `Android Debug Build` and `iOS Simulator Build`. Do not run gradlew/pod locally.
- **Verify evidence format in CI:** `GroundPin Evidence Verify` runs `bash tools/verify.sh --self-test`.

### Approach

1. **Platform parity.** Every feature must work on both iOS and Android through React Native + native module bridges. When implementing a native module, implement both Swift (iOS) and Kotlin (Android) sides, exposing the same TypeScript interface.
2. **No network (app runtime).** The app must never make network requests. No remote resources, analytics, or crash reporting SDKs. (CI and `gh`/`git push` are fine on the dev machine.)
3. **No Google Play Services.** On Android, use `android.location.LocationManager` (never `FusedLocationProviderClient`), `MediaRecorder` for audio, system Camera Intent or Camera2 for photos/video. No Play Services, Firebase, or Google-proprietary SDKs.
4. **Evidence integrity.** Every attachment must have a corresponding anchor JSON with the location quintuple. Time must use EvidenceClock (location timestamp + monotonic delta), never `Date.now()` or device wall clock. GPG signatures must be verifiable with standard `gpg --verify`.
5. **Cloud-first build.** All compile/link/package verification runs on GitHub Actions. Local = edit + push + read CI.

### Native / RN stack notes (from CI fixes)

- RN **0.79.2** requires `@react-native-community/cli@18.0.0` (+ platform-android/ios) in devDependencies for autolinking; declare `android.packageName` in `react-native.config.js`.
- **Legacy bridge** (`newArchEnabled=false`): custom modules use `ReactContextBaseJavaModule` / `RCT_EXTERN_MODULE`, not TurboModules.
- `react-native-screens@4.18.0` — 4.19+ codegen requires RN 0.81+; do not bump screens without checking Fabric compat table.
- iOS ZIP: use pure Swift `ZipWriter` (zlib DEFLATE); **never** `Process` + `/usr/bin/zip` (unavailable on iOS).

### Key invariants (do not break these)

- App only refreshes location when foreground + main screen visible, every 1 second. Stops immediately on background/inactive.
- No background location permission is ever requested.
- Attachments persist across app restarts and can accumulate over days/weeks/months.
- The 10-minute attachment window never survives an app restart — must reacquire a valid location fix.
- Yellow state (recent valid anchor but current GPS invalid) allows attachments only, never final check-in.
- Green state (current GPS valid) is the only state that generates the final evidence zip.
- Location validity (ruleset v2): accuracy < 15m passes immediately after base checks; accuracy >= 15m requires at least one accuracy change among the last 5 samples (guards against stagnant mixed/cached fixes).
- `sig.gpg` must be a real OpenPGP detached signature verifiable with `gpg --verify sig.gpg hashes.txt`.
- Every attachment deletion must also delete its corresponding anchor JSON.
- `hashes.txt` uses dictionary-sorted paths, does not include itself or `sig.gpg`, but includes `public_key.asc`.

---

## Architecture

### Entry Points

- `src/App.tsx` — React Native root component.
- `src/screens/MainScreen.tsx` — Main UI with the tri-state button, attachment controls, and location status.
- `src/screens/AttachmentsScreen.tsx` — Attachment list with delete capability.
- Native module entry points: `ios/GroundPin/` (Swift) and `android/app/src/main/java/com/groundpin/` (Kotlin).

### Key Modules

- `src/native/NativeLocation.ts` — TypeScript bridge to iOS CoreLocation / Android LocationManager.
- `src/native/NativeDeviceKey.ts` — TypeScript bridge to iOS Keychain / Android Keystore for OpenPGP key generation.
- `src/native/NativeMedia.ts` — TypeScript bridge to camera, audio recording, video capture.
- `src/native/NativePackage.ts` — TypeScript bridge to zip creation and system share sheet.
- `src/utils/evidenceClock.ts` — EvidenceClock: derives attachment times from location timestamp + monotonic delta.
- `src/utils/locationValidation.ts` — Location validity checks (accuracy, age, provider, mock detection, stagnant accuracy, speed sanity).
- `src/utils/hashesTxt.ts` — `hashes.txt` generator with SHA-256, sorted paths, strict formatting.
- `src/storage/attachmentStore.ts` — Persistent attachment records with anchor JSON pairing.

### Data Flow

1. **Location:** Native module → 1s foreground polling → `LocationFix` type → JS validation → tri-state button logic.
2. **Attachment creation:** User taps media button → native capture → file saved to app-private storage → anchor JSON generated with EvidenceClock-derived timestamp → attachment record persisted.
3. **Check-in package:** User taps green button → all undeleted attachments + anchor JSONs + `manifest.json` + `location.json` + `deviceRecord.json` + `public_key.asc` collected → SHA-256 hashes computed → `hashes.txt` written → OpenPGP detached signature generated → zip created → system share sheet.

---

## CI Reference Commands (run in CI or when user explicitly allows Node)

These are **not** for the code-only MacBook Neo loop; they document what GitHub Actions executes:

```bash
npm ci
npm run typecheck     # tsc --noEmit
npm run lint          # eslint
npm test              # jest
cd android && ./gradlew assembleDebug
cd ios && pod install && xcodebuild …
bash tools/verify.sh --self-test
```

---

## Cache Stability

- **Frequently-rebuilt files:** `package-lock.json`, `Gemfile.lock`, `ios/Pods/`, `android/.gradle/`, `android/app/build/`.
- **Stable scaffolding:** `AGENTS.md`, `package.json` (scripts section), `tools/verify.sh`, `.github/workflows/*.yml`, `src/utils/*.ts` (algorithm code), TypeScript type definitions.
- **Append, don't reorder:** When adding new CI jobs or new utility modules, append to existing files. Avoid reordering `hashes.txt` generation logic or evidence format definitions — byte stability matters for verification reproducibility.

---

## Guidelines

- Follow existing TypeScript patterns: const enums, branded types where appropriate, exhaustive switch on union types.
- Native modules must expose Promise-based async interfaces; avoid callbacks in the bridge layer.
- Every native module method must handle permission denied, hardware unavailable, and unexpected null returns gracefully — surface errors to JS as structured error objects, never crash.
- Write tests for pure utility functions (location validation, evidence clock, hash text formatting, file name generation).
- Keep changes focused and atomic — a single commit should not mix UI refactors with native module changes.
- Document native module APIs with JSDoc on the TypeScript side and inline comments on the Swift/Kotlin side.
- Update this file when project conventions change or new invariants are established.
- The target README.md must explain: project goal, install steps, iOS/Android run commands, permission requirements, location lifecycle, tri-state button behavior, attachment accumulation rules, GPG verification steps, platform limitations, and security boundaries.
