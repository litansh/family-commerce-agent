#!/usr/bin/env bash
# Boot an iPhone simulator, build Kaniti for it once, run Maestro flows.
set -euo pipefail
cd "$(dirname "$0")/.."
export JAVA_HOME=/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home
export PATH="$JAVA_HOME/bin:$HOME/.maestro/bin:$PATH"
set -a; source "$HOME/.kaniti/e2e.env"; set +a
export EMAIL="$KANITI_E2E_EMAIL" PASSWORD="$KANITI_E2E_PASSWORD"
DEV=$(xcrun simctl list devices available -j | python3 -c 'import json,sys; d=json.load(sys.stdin); ds=[x for v in d["devices"].values() for x in v if x["name"].startswith("iPhone")]; print(sorted(ds,key=lambda x:x["name"])[-1]["udid"])')
xcrun simctl boot "$DEV" 2>/dev/null || true
open -a Simulator
if [ "${REBUILD:-0}" = "1" ] || ! xcrun simctl get_app_container "$DEV" com.litansh.kaniti >/dev/null 2>&1; then
  EXPO_PUBLIC_SKIP_INTRO=1 npx expo run:ios --device "$DEV" --no-bundler 2>&1 | tail -3
fi
mkdir -p maestro/shots
FLOWS=("${@:-signin household tabs connect}")
for f in ${FLOWS[@]}; do maestro --device "$DEV" test "maestro/$f.yaml" || true; done
