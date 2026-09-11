#!/usr/bin/env bash
# Every store's connect flow, up to the store's own sign-in screen, with a screenshot each.
# Prints a table: store | reached sign-in | still not connected.
set -uo pipefail
cd "$(dirname "$0")/.."
export JAVA_HOME=/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home
export PATH="$JAVA_HOME/bin:$HOME/.maestro/bin:$PATH"
DEV=$(xcrun simctl list devices -j | python3 -c 'import json,sys; d=json.load(sys.stdin); ds=[x for v in d["devices"].values() for x in v if x["name"].startswith("iPhone") and x.get("isAvailable")]; b=[x for x in ds if x["state"]=="Booted"]; p=[x for x in ds if x["name"]=="iPhone 17 Pro"]; print((b or p or ds)[0]["udid"])')
mkdir -p maestro/shots/connect
# store id | words the store's sign-in shows (whole-string regex, Maestro style)
STORES=(
  "rami-levy|.*(קוד|SMS|דואר אלקטרוני|כניסה).*"
  "victory|.*(קוד חד פעמי|טלפון|כניסת משתמש|כניסה|סיסמה).*"
  "wolt|.*(אימייל|Email|מייל|התחבר|כניסה|Log in).*"
  "shufersal|.*(סיסמה|כתובת מייל|התחברות|כניסה).*"
  "carrefour|.*(סיסמה|דואר אלקטרוני|כניסת משתמש|כניסה).*"
  "keshet-teamim|.*(סיסמה|דואר אלקטרוני|כניסת משתמש|כניסה).*"
  "mahsanei-hashuk|.*(סיסמה|דואר אלקטרוני|כניסת משתמש|כניסה).*"
  "tiv-taam|.*(סיסמה|דואר אלקטרוני|כניסת משתמש|כניסה).*"
  "hazi-hinam|.*(סיסמה|דוא.ל|כניסה לחשבון).*"
)
printf "%-16s %-16s %-16s\n" store "sign-in shown" "not connected"
for entry in "${STORES[@]}"; do
  id="${entry%%|*}"; re="${entry#*|}"
  xcrun simctl terminate "$DEV" com.litansh.kaniti >/dev/null 2>&1 || true
  xcrun simctl openurl "$DEV" "com.litansh.kaniti://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081" >/dev/null 2>&1
  out=$(maestro --device "$DEV" test -e STORE="$id" -e LOGIN="$re" maestro/connect-one.yaml 2>&1)
  signin=$(echo "$out" | grep -q 'is visible... COMPLETED' && echo "$out" | grep -qE 'Assert that "\$\{LOGIN\}|Assert that ".*\(' && echo yes || echo NO)
  sleep 2; xcrun simctl io "$DEV" screenshot "maestro/shots/connect/$id.png" >/dev/null 2>&1
  back=$(maestro --device "$DEV" test -e STORE="$id" maestro/connect-back.yaml 2>&1)
  notconn=$(echo "$back" | grep -qE "Assert that id: connect-$id is visible... COMPLETED" && echo yes || echo NO)
  printf "%-16s %-16s %-16s\n" "$id" "$signin" "$notconn"
  { echo "$out"; echo "$back"; } > "maestro/shots/connect/$id.log"
done
