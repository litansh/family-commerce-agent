# Mac runbook — first real connection

Everything below runs on the Mac at home. Nothing is charged at any step unless you tap **Approve** in the app.

## 0. Once: your household

1. Open https://d3lykvs28o7qrc.cloudfront.net on your phone (or the Mac).
2. **Sign up — new account** → your email → verify → create the household: real name, real delivery address, country **IL**, pick **shufersal** (and rami-levy), choose delivery.
3. Tab **Me** → note the household ID (looks like `27-KNLZN`).

## 1. Link Shufersal (5 min)

```bash
cd ~/GolandProjects/family-commerce-agent
source ~/.kanili/env
export KANILI_HOUSEHOLD=<your household id>
export KANILI_RETAILER=shufersal
npm run link -w @fca/order-worker
```
A Chrome window opens on Shufersal Online's login page. It takes **email + password** (Shufersal Online has no SMS sign-in; the club-identification link is for people who don't shop online). Your password is almost always already saved on your iPhone: *Settings → Passwords → search "shufersal"*. If not, *שכחתי סיסמה* once — the reset link arrives by email and takes a minute. The session is then kept and reused. When you're in, the terminal prints *Session saved* and the window closes. The session is reused from then on. (The **Me** tab has a "Copy the command" button that fills in your ID.)

## 2. Start the worker (leave it running)

```bash
npm start -w @fca/order-worker
```
Within 30 seconds the **Me** tab shows *Home computer online* and Shufersal *Linked*.

## 3. Learn from your history

In the app, tab **List** → **Import past orders**. Watch the terminal: `connecting → reading → resolving → done`. Then tab **Home**: your usuals appear with photos.

If it says *failed*, the terminal line and `services/order-worker/trace/*.png` show exactly where — send me the message; the first contact with a real page usually needs one or two selector fixes from me.

## 4. First test order — stops before payment

1. **Home** → *Add the usual shop* (or add a few items) → **List** → *Compare*.
2. *Order through Kanili · ₪X*. The **Orders** screen shows each step as the worker does it.
3. It stops at **Waiting for your approval** with the retailer's real total, slot and payment method. **Don't approve yet** — tell me, and I'll check the trace matches what Shufersal shows.
4. When it's right: **Approve and pay ₪X**. The worker places the order; the screen shows *Order placed* with Shufersal's order number.

## 5. Rami Levy — same loop

```bash
export KANILI_RETAILER=rami-levy
npm run link -w @fca/order-worker
```
Restart `npm start` afterwards so the heartbeat shows both stores linked. Then steps 3–4 again.

## If something's off

- *Home computer offline* in the app → the `npm start` terminal isn't running.
- *saved session expired* → run step 1 again for that store.
- An order stuck at *queued* → worker not running; it will pick it up when started.
- Anything else: `ls services/order-worker/trace/` — every miss has a screenshot named after the step.
