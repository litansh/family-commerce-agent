# What Kaniti promises a family

The "what". Short, testable, in the family's words. Every agent reads this before it
judges the product; the "how" is the agents' and the code's business. A promise broken
is a bug even if every unit test passes. Each promise ends with how an agent can tell.

## 1. One list, the whole picture
The family types a list once. Kaniti shows what it costs at **every** store that reaches
them: online delivery, Wolt, and driving to a branch nearby.
- *Tell:* every storefront that delivers to the address appears on the compare, either as
  an option or as a rejected row with a reason a person understands (coverage, minimum).
  Nothing disappears silently.

## 2. The cheapest way, and the fastest, and why
For any list there is a cheapest way to buy it and a fastest way, and the difference is
stated in money and minutes. When buying from two stores saves money, that split is
offered; when it does not, it is not.
- *Tell:* a cheapest option exists and is the lowest cash among options. A fastest option
  exists with a measured time (live ETA) or a declared window. A split is offered iff it
  saves more than the threshold and each leg clears its store's minimum; "only one option"
  must be explainable from the rejected rows and the log.

## 3. Nothing is dropped for one missing item
A store that lacks one line still competes: the closest product it does carry is priced
and **named** on the card ("סלמון → פילה סלמון נורבגי"), or the store takes the lines it
has as one leg of a split.
- *Tell:* a store rejected for coverage has substitutes or appears as a split leg; a
  substituted line is flagged and named; no substitute is a different category.

## 4. Numbers are honest
Every comparison is like for like. Cash and time are never summed. A partial basket is
never compared against a full one. A branch that prices 22 of 39 lines says so.
- *Tell:* for an option, legs' items + fees = cash. For an in-store row with partial
  coverage, the comparison is against the same lines at the winning store, and no saving
  is claimed. Every number on a card can be recomputed from the response.

## 5. Once connected, always connected
Connecting a store happens once, on the phone, in the store's own sign-in. After that the
family is never asked again unless the store itself closed the session; then Kaniti says
so with the one step to fix it.
- *Tell:* no "needs re-connecting" on a single look; the store's own signed-in answer
  clears it; the connect rate per store and the false-reconnect count are in the log.

## 6. The cart fills itself; the purchase is the family's
"Buy via Kaniti" fills the store's cart with the chosen lines; checkout and payment stay
at the store. Kaniti then learns from the store's own order history what was bought.
- *Tell:* every line of the winning option has a barcode or a link; the simulator fills
  the Rami Levy cart; a purchase is confirmed from history without a tap.

## 7. It remembers the family
After a few cycles Kaniti suggests what they usually buy, prefers their brands, and
catches what they forgot.
- *Tell:* memory learns only from confirmed purchases; suggestions come from the memory,
  not from a generic list.

## 8. Stores change; the family never notices
A new consent sheet, a Cloudflare challenge, a moved login, a renamed price file: the
cold path (the daily agents) meets it; the phone keeps working.
- *Tell:* the daily health checks are green; a red check becomes a pull request the same
  day; the briefing names the single next thing.

## 9. What Kaniti says is what the store shows
Every claim about a store - connected, added to the cart, bought - is verified against the
store's own state before it is shown, and the store's own number is shown next to ours. A
difference is said out loud, never hidden; the family is never sent to act on a guess.
- *Tell:* after a cart fills, the screen shows the store's basket count beside "added" and they
  agree; the cart lab fails when the store's basket does not show the lines; a connect is "connected"
  only after the store's own signed-in check; a purchase is confirmed from the store's history.

## What to do when a promise is broken
Reproduce it in a lab (the API, the browser labs, the simulator), name the promise
number, fix the cause or the check, prove it with the same lab, open a pull request
through `ops/pr.sh`. Never make a check pass by weakening the promise.
