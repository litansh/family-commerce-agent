#!/usr/bin/env bash
# Boot an iPhone simulator, build Kaniti for it once, run Maestro flows.
set -euo pipefail
cd "$(dirname "$0")/.."
export JAVA_HOME=/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home
export PATH="$JAVA_HOME/bin:$HOME/.maestro/bin:$PATH"
set -a; source "$HOME/.kaniti/e2e.env"; set +a
export EMAIL="$KANITI_E2E_EMAIL" PASSWORD="$KANITI_E2E_PASSWORD"
export EXPO_PUBLIC_E2E_EMAIL="$KANITI_E2E_EMAIL" EXPO_PUBLIC_E2E_PASSWORD="$KANITI_E2E_PASSWORD" EXPO_PUBLIC_E2E_RESET_LIST=1 EXPO_PUBLIC_E2E_ORDER_STORE=rami-levy
# One simulator, always the same: a booted iPhone if there is one, else the iPhone 17 Pro.
DEV=$(xcrun simctl list devices -j | python3 -c 'import json,sys; d=json.load(sys.stdin); ds=[x for v in d["devices"].values() for x in v if x["name"].startswith("iPhone") and x.get("isAvailable")]; b=[x for x in ds if x["state"]=="Booted"]; p=[x for x in ds if x["name"]=="iPhone 17 Pro"]; print((b or p or ds)[0]["udid"])')
xcrun simctl boot "$DEV" 2>/dev/null || true
open -a Simulator
APP=ios/build/Build/Products/Debug-iphonesimulator/Kaniti.app
if [ "${REBUILD:-0}" = "1" ] || [ ! -d "$APP" ]; then
  [ -d ios ] || npx expo prebuild --platform ios 2>&1 | tail -1
  # Ad-hoc local signing: the simulator needs it for the keychain entitlement (secure store), no Apple account needed.
  xcodebuild -workspace ios/Kaniti.xcworkspace -scheme Kaniti -configuration Debug -sdk iphonesimulator -destination "platform=iOS Simulator,id=$DEV" -derivedDataPath ios/build CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= build 2>&1 | grep -E "error:|BUILD (SUCCEEDED|FAILED)" | tail -5
fi
xcrun simctl install "$DEV" "$APP"
# Metro serves the JS; the dev client opens it through its own URL scheme.
if ! curl -s -o /dev/null http://localhost:8082/status; then (EXPO_PUBLIC_SKIP_INTRO=1 EXPO_PUBLIC_E2E_EMAIL="$EMAIL" EXPO_PUBLIC_E2E_PASSWORD="$PASSWORD" EXPO_PUBLIC_E2E_RESET_LIST=1 EXPO_PUBLIC_E2E_ORDER_STORE=rami-levy CI=1 npx expo start --port 8082 > /tmp/metro.log 2>&1 &); until curl -s -o /dev/null http://localhost:8082/status; do sleep 2; done; fi
xcrun simctl terminate "$DEV" com.litansh.kaniti 2>/dev/null || true
xcrun simctl openurl "$DEV" "com.litansh.kaniti://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8082"
mkdir -p maestro/shots
FLOWS=("${@:-all}")
for f in ${FLOWS[@]}; do maestro --device "$DEV" test -e EMAIL="$EMAIL" -e PASSWORD="$PASSWORD" "maestro/$f.yaml" || true; xcrun simctl io "$DEV" screenshot "maestro/shots/$f.png" >/dev/null 2>&1; done
