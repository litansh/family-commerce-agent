# Intro — design review

**Reviewed:** the four-screen introduction shown after sign-in, on the live web build at phone width.
**Reviewers' brief:** a graphic designer's pass (composition, type, colour, motion) and a UX pass (comprehension, effort, what the person feels at each screen). Comments first, then what changed.

## Graphic design comments

**G1 — It reads as a settings page, not a first impression.** Every screen is text-on-paper with a small element in the middle. There is no visual system that says "this is the thing I downloaded." *Fix:* each screen gets a full-bleed colour field at the top (green → amber → ink → green) with the illustration living inside it, and the copy below on paper. Four screens, four moods, one arc.

**G2 — The chain chips in screen 1 are the most interesting object and they are tiny.** *Fix:* chips become large pill "storefronts" with the chain's initial in a coloured square, orbiting a bigger Kaniti tile; the merge animation ends with a soft scale-bounce on the tile and a check drawing itself.

**G3 — No hierarchy between title and body.** Display 30 / body 16 on the same left edge, same colour weight. *Fix:* display 34/800 with tight tracking, body 17 with 26 line-height in muted ink, generous 20px gap; one idea per screen, ≤ 2 sentences.

**G4 — The progress dots are an afterthought.** *Fix:* a segmented progress bar at the top of the colour field, and the step counter inside the CTA ("הבא · 2 מתוך 4").

**G5 — Motion is on only one screen.** *Fix:* every screen enters with a 300ms fade-and-rise; the interactive object responds within 100ms of a tap (scale 0.96 → 1) with haptic feedback on native.

**G6 — The rhythm screen looks like a spreadsheet row.** *Fix:* a big milk carton emoji at 64pt, the day counter as the hero number, and a ring that fills — the "due" state turns the ring amber and pulses once.

## UX comments

**U1 — The person is asked to tap on screen 1 but nothing tells them why.** "Tap to merge" is a mechanic, not a promise. *Fix:* the tap target is the sentence itself — "הקישו כדי לראות איך זה עובד" — and the payoff line states the benefit: "סל אחד. הזמנה אחת. כל הרשתות."

**U2 — Screen 2's memory box is empty until the third tap; the first two taps feel broken.** *Fix:* the first tap already writes the item into the "family memory" card with a subtle slide-in; the "usual shop" line appears at three.

**U3 — Screen 4 asks for three taps to demonstrate three taps; fine — but the third tap ends with text.** *Fix:* the third tap animates a basket check and the CTA changes to "מתחילים" in the same beat, so the demonstration and the real start are one gesture.

**U4 — "Skip" is the most prominent text on the page after the title.** *Fix:* muted, top corner, smaller; still one tap away.

**U5 — Nothing on any screen mentions what happens *after* — the household setup.** The intro ends, then a form appears. *Fix:* the last screen's body says the next screen takes one minute and asks for the address.

**U6 — Hebrew typography.** Mixed Hebrew/Latin brand name on one line breaks the rhythm. *Fix:* the Hebrew name is the display; "Kaniti" appears once, small, under it.

## Kept as is
- One idea per screen; the four ideas are the right four (one shop, memory, nothing forgotten, three taps).
- Interactivity on every screen — the strongest choice in the original.
- Reopenable from *Me*.

## After the fixes — what a first-time user does
Sees a green field with six storefronts orbiting a basket; taps the sentence; the storefronts fly in, the basket bounces, a check draws. Swipes; taps three foods, watches a memory card fill. Sees milk go "due" on a ring. Taps three real-looking steps and the last one becomes the start button. About 40 seconds, four taps minimum, and they have *felt* the product before the address form.
