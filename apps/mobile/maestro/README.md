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
