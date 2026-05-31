#!/usr/bin/env bash
set -euo pipefail

# GroundPin Evidence Package Verification Script
# Usage:
#   tools/verify.sh path/to/groundpin_attendance_xxx.zip
#   tools/verify.sh --self-test

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

say_ok() { echo -e "${GREEN}[OK]${NC} $*"; }
say_fail() { echo -e "${RED}[FAIL]${NC} $*"; }

check_tool() {
  local tool="$1"
  if ! command -v "$tool" &>/dev/null; then
    say_fail "Missing required tool: $tool"
    exit 1
  fi
}

self_test() {
  echo "=== GroundPin verify.sh self-test ==="
  echo ""

  check_tool gpg
  check_tool unzip
  check_tool shasum

  local tmpdir
  tmpdir="$(mktemp -d)"
  trap "rm -rf '$tmpdir'" EXIT

  # Generate a temporary GPG key for testing
  echo "Generating test GPG key..."
  local gpg_home="$tmpdir/gnupg"
  mkdir -p "$gpg_home"
  chmod 700 "$gpg_home"

  gpg --homedir "$gpg_home" --batch --passphrase '' --quick-gen-key \
    "GroundPin Test Key" ed25519 sign never 2>/dev/null

  # Export public key
  gpg --homedir "$gpg_home" --armor --export "GroundPin Test Key" > "$tmpdir/public_key.asc"

  # Create a sample hashes.txt
  local data_dir="$tmpdir/data"
  mkdir -p "$data_dir"

  echo "test content 1" > "$data_dir/file1.txt"
  echo "test content 2" > "$data_dir/file2.txt"
  echo "test content 3" > "$data_dir/file3.txt"

  # Generate hashes.txt (sorted by path)
  > "$data_dir/hashes.txt"
  for f in "$data_dir/file1.txt" "$data_dir/file2.txt" "$data_dir/file3.txt"; do
    local rel="$(basename "$f")"
    local hash
    hash="$(shasum -a 256 "$f" | awk '{print $1}')"
    echo "SHA256  $rel  $hash" >> "$data_dir/hashes.txt"
  done

  # Sign hashes.txt with GPG detached signature
  gpg --homedir "$gpg_home" --batch --passphrase '' --armor \
    --detach-sign --output "$data_dir/sig.gpg" "$data_dir/hashes.txt" 2>/dev/null

  # Create a test zip
  local zip_path="$tmpdir/test_package.zip"
  cd "$data_dir"
  zip -q "$zip_path" hashes.txt sig.gpg file1.txt file2.txt file3.txt
  cp "$tmpdir/public_key.asc" public_key.asc
  zip -q "$zip_path" public_key.asc
  cd - >/dev/null

  say_ok "Test package created at $zip_path"

  # Now verify using main logic
  verify_package "$zip_path"

  say_ok "Self-test passed"
}

verify_package() {
  local zip_path="$1"

  if [ ! -f "$zip_path" ]; then
    say_fail "Zip file not found: $zip_path"
    exit 1
  fi

  say_ok "Zip file found: $zip_path"

  local workdir
  workdir="$(mktemp -d)"
  trap "rm -rf '$workdir'" EXIT

  # Unzip
  echo "Extracting..."
  unzip -q "$zip_path" -d "$workdir"
  say_ok "Extracted to $workdir"

  cd "$workdir"

  # Verify required files exist
  for required in hashes.txt sig.gpg public_key.asc; do
    if [ ! -f "$required" ]; then
      say_fail "Missing required file: $required"
      exit 1
    fi
  done
  say_ok "All required files present"

  # Import public key
  echo ""
  echo "Importing public key..."
  gpg --batch --import public_key.asc 2>/dev/null
  local fingerprint
  fingerprint="$(gpg --list-keys --with-colons 2>/dev/null | grep '^fpr:' | head -1 | cut -d: -f10)"
  say_ok "Public key imported (fingerprint: ${fingerprint:0:16}...)"

  # Verify GPG signature
  echo ""
  echo "Verifying OpenPGP detached signature..."
  if gpg --batch --verify sig.gpg hashes.txt 2>&1; then
    say_ok "GPG signature verification passed"
  else
    say_fail "GPG signature verification failed"
    exit 1
  fi

  # Verify SHA-256 hashes
  echo ""
  echo "Verifying SHA-256 hashes..."
  local hash_errors=0
  local hash_count=0

  while read -r alg path hex; do
    if [ -z "$alg" ]; then
      continue
    fi

    if [ "$alg" != "SHA256" ]; then
      say_fail "Unsupported hash algorithm: $alg (path: $path)"
      exit 1
    fi

    if [ ! -f "$path" ]; then
      say_fail "File not found for hash verification: $path"
      hash_errors=$((hash_errors + 1))
      continue
    fi

    local actual
    actual="$(shasum -a 256 "$path" | awk '{print $1}')"

    if [ "$actual" != "$hex" ]; then
      say_fail "Hash mismatch: $path"
      echo "  expected: $hex"
      echo "  actual:   $actual"
      hash_errors=$((hash_errors + 1))
    else
      hash_count=$((hash_count + 1))
    fi
  done < hashes.txt

  if [ "$hash_errors" -eq 0 ]; then
    say_ok "All $hash_count file hashes verified"
  else
    say_fail "$hash_errors hash mismatch(es) found"
    exit 1
  fi

  echo ""
  echo "=== Verification complete ==="
}

# Main
if [ $# -eq 0 ]; then
  echo "Usage: $0 <path/to/groundpin_attendance.zip>"
  echo "       $0 --self-test"
  exit 1
fi

if [ "$1" = "--self-test" ]; then
  self_test
else
  verify_package "$1"
fi
