#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

IMAGE_NAME="${1:-guowenju/navix-server}"
IMAGE_TAG="${2:-}"
DOCKERFILE_PATH="${DOCKERFILE_PATH:-$SCRIPT_DIR/Dockerfile}"
NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com/}"
CARGO_REGISTRY_MIRROR="${CARGO_REGISTRY_MIRROR:-sparse+https://mirrors.ustc.edu.cn/crates.io-index/}"
APT_MIRROR="${APT_MIRROR:-http://mirrors.ustc.edu.cn}"

if [[ ! -f "$DOCKERFILE_PATH" ]]; then
  echo "Dockerfile not found at ${DOCKERFILE_PATH}" >&2
  exit 1
fi

if [[ -z "$IMAGE_TAG" ]]; then
  IMAGE_TAG="$(awk '
    /^\[workspace\.package\]/ { in_section = 1; next }
    /^\[/ { if (in_section) exit }
    in_section && /version[[:space:]]*=/ {
      if (match($0, /"[^"]+"/)) {
        print substr($0, RSTART + 1, RLENGTH - 2)
        exit
      }
    }
  ' "$REPO_ROOT/Cargo.toml")"
  IMAGE_TAG="${IMAGE_TAG:-latest}"
fi

BUILD_ARGS=()

for arg_name in NPM_REGISTRY CARGO_REGISTRY_MIRROR APT_MIRROR; do
  if [[ -n "${!arg_name:-}" ]]; then
    BUILD_ARGS+=(--build-arg "${arg_name}=${!arg_name}")
  fi
done

docker build "${BUILD_ARGS[@]}" -f "$DOCKERFILE_PATH" -t "${IMAGE_NAME}:${IMAGE_TAG}" "$REPO_ROOT"
