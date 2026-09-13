#!/usr/bin/env bash
set -euo pipefail

target="${JARVIS_PIPER_DIR:-/opt/dripvid-jarvis/piper}"
piper_version="${JARVIS_PIPER_VERSION:-1.2.0}"
voice="${JARVIS_PIPER_VOICE_ID:-en_GB-alan-medium}"

case "$(uname -m)" in
  x86_64|amd64)
    archive="piper_amd64.tar.gz"
    ;;
  aarch64|arm64)
    archive="piper_arm64.tar.gz"
    ;;
  armv7l|armv7)
    archive="piper_armv7.tar.gz"
    ;;
  *)
    echo "Unsupported architecture for Piper binary: $(uname -m)" >&2
    exit 1
    ;;
esac

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

mkdir -p "$target"

curl -fsSL \
  "https://github.com/rhasspy/piper/releases/download/v${piper_version}/${archive}" \
  -o "$tmp/piper.tar.gz"

tar -xzf "$tmp/piper.tar.gz" -C "$tmp"
piper_bundle="$(find "$tmp" -type f -name piper -exec dirname {} \; | head -n 1)"
if [[ -z "$piper_bundle" ]]; then
  echo "Piper archive did not contain a piper binary" >&2
  exit 1
fi

cp -a "$piper_bundle/." "$target/"
chmod 0755 "$target/piper"

if [[ "$voice" =~ ^([a-z]{2})_([A-Z]{2})-([^-]+)-([^-]+)$ ]]; then
  language="${BASH_REMATCH[1]}"
  locale="${BASH_REMATCH[1]}_${BASH_REMATCH[2]}"
  speaker="${BASH_REMATCH[3]}"
  quality="${BASH_REMATCH[4]}"
  voice_path="${language}/${locale}/${speaker}/${quality}"
else
  echo "Unsupported Piper voice id: $voice" >&2
  exit 1
fi

curl -fsSL \
  "https://huggingface.co/rhasspy/piper-voices/resolve/main/${voice_path}/${voice}.onnx" \
  -o "$target/${voice}.onnx"

curl -fsSL \
  "https://huggingface.co/rhasspy/piper-voices/resolve/main/${voice_path}/${voice}.onnx.json" \
  -o "$target/${voice}.onnx.json"

echo "Installed Piper voice:"
echo "  JARVIS_VOICE_PROVIDER=piper"
echo "  JARVIS_PIPER_BIN=$target/piper"
echo "  JARVIS_PIPER_MODEL=$target/${voice}.onnx"
echo "  JARVIS_PIPER_VOICE_ID=$voice"
