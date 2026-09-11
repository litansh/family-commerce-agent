#!/usr/bin/env bash
# Every store's connect flow, up to the store's own sign-in screen, with a screenshot each.
# Prints a table: store | reached sign-in | still not connected.
set -uo pipefail
cd "$(dirname "$0")/.."
export JAVA_HOME=/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home
export PATH="$JAVA_HOME/bin:$HOME/.maestro/bin:$PATH"
DEV=$(xcrun simctl list devices -j | python3 -c 'import json,sys; d=json.load(sys.stdin); ds=[x for v in d["devices"].values() for x in v if x["name"].startswith("iPhone") and x.get("isAvailable")]; b=[x for x in ds if x["state"]=="Booted"]; p=[x for x in ds if x["name"]=="iPhone 17 Pro"]; print((b or p or ds)[0]["udid"])')
mkdir -p maestro/shots/connect
# The simulator's own Metro (port 8082, test sign-in baked in); the phone tunnel keeps 8081.
set -a; source "$HOME/.kaniti/e2e.env"; set +a
if ! curl -s -o /dev/null http://localhost:8082/status; then (EXPO_PUBLIC_SKIP_INTRO=1 EXPO_PUBLIC_E2E_EMAIL="$KANITI_E2E_EMAIL" EXPO_PUBLIC_E2E_PASSWORD="$KANITI_E2E_PASSWORD" EXPO_PUBLIC_E2E_RESET_LIST=1 EXPO_PUBLIC_E2E_ORDER_STORE=rami-levy npx expo start --port 8082 < /dev/null > /tmp/metro-sim.log 2>&1 &); until curl -s -o /dev/null http://localhost:8082/status; do sleep 2; done; fi
# store id | words the store's sign-in shows (whole-string regex, Maestro style)
STORES=(
  "rami-levy|.*(בחר שיטת קבלת קוד|שלח קוד אימות|קריאה קולית).*"
  "victory|.*(קוד חד פעמי|שלח קוד|הקלד את מספר הטלפון).*"
  "wolt|.*(Use only necessary|Allow|Log in|התחבר|כניסה עם|Continue with).*"
  "shufersal|.*(כתובת מייל|התחברות|שכחתי סיסמה).*"
  "carrefour|.*(E-mail|Password|כניסת משתמש|דואר אלקטרוני).*"
  "keshet-teamim|.*(E-mail|Password|כניסת משתמש|דואר אלקטרוני).*"
  "mahsanei-hashuk|.*(E-mail|Password|כניסת משתמש|דואר אלקטרוני).*"
  "tiv-taam|.*(E-mail|Password|כניסת משתמש|דואר אלקטרוני).*"
  "hazi-hinam|.*(כניסה לחשבון שלי|אני לא רובוט|שכחתי את הסיסמה).*"
)
printf "%-16s %-16s %-16s\n" store "sign-in shown" "not connected"
for entry in "${STORES[@]}"; do
  id="${entry%%|*}"; re="${entry#*|}"
  if [ $# -gt 0 ] && ! printf "%s\n" "$@" | grep -qx "$id"; then continue; fi
  xcrun simctl terminate "$DEV" com.litansh.kaniti >/dev/null 2>&1 || true
  xcrun simctl openurl "$DEV" "com.litansh.kaniti://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8082" >/dev/null 2>&1
  out=$(maestro --device "$DEV" test -e STORE="$id" -e LOGIN="$re" maestro/connect-one.yaml 2>&1)
  signin=$(echo "$out" | grep -q 'is visible... COMPLETED' && echo "$out" | grep -qE 'Assert that "\$\{LOGIN\}|Assert that ".*\(' && echo yes || echo NO)
  sleep 2; xcrun simctl io "$DEV" screenshot "maestro/shots/connect/$id.png" >/dev/null 2>&1
  back=$(maestro --device "$DEV" test -e STORE="$id" maestro/connect-back.yaml 2>&1)
  notconn=$(echo "$back" | grep -qE "Assert that id: connect-$id is visible... COMPLETED" && echo yes || echo NO)
  printf "%-16s %-16s %-16s\n" "$id" "$signin" "$notconn"
  { echo "$out"; echo "$back"; } > "maestro/shots/connect/$id.log"
done
