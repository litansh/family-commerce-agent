# Driving Kaniti in the iPhone simulator

Maestro taps through the real app (`npx expo run:ios`, bundle `com.litansh.kaniti`) so nobody has
to paste issues from a phone. Credentials for the simulator's test household live in
`~/.kaniti/e2e.env` (created by the session's mkuser script, never in the repo).

    ./maestro/run.sh            # boot a simulator, build if needed, run every flow, screenshots in maestro/shots
    ./maestro/run.sh connect    # one flow

Flows: `signin` (Cognito e-mail + password), `household` (create one if the account has none),
`tabs` (home → list → orders → me), `connect` (Me → connect Shufersal → the store's login page
inside the WebView, the e-mail prefilled). The SMS code and Face ID need a real phone; the
simulator proves everything up to the store's own form.

## Status (2026-09-11)

`./maestro/run.sh` runs `maestro/all.yaml` on the iPhone 17 Pro simulator: 12 steps, all green.
It boots the sim, builds the ad-hoc-signed debug app if missing, serves JS from Metro (with the
E2E env creds baked in), reloads the app, then drives: auto sign-in → create the household
(name + verified address) → walk List/Orders/Me tabs → connect a store (its own login opens in
the WebView with the family's e-mail prefilled). Screenshots land in `maestro/shots/`.

Metro for the simulator runs on port 8082 without `CI=1`: in CI mode Metro disables watch
mode and keeps serving the bundle it built at start-up, so edits under `src/` never reach the
app (the build stamp in the Me header tells you which bundle is running). `metro.config.js`
watches only `node_modules`, `packages` and `services`, not the whole repo.

Requirements installed on this Mac: Xcode 26 + iOS 26.5 simulator runtime, CocoaPods (brew),
OpenJDK (brew, for Maestro), Maestro (~/.maestro). The test Cognito user is in `~/.kaniti/e2e.env`.
No Apple Developer account is needed for the simulator.
