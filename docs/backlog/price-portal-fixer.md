# price-portal-fixer's lines

One file per agent so two agents never edit the same file (parallel runs kept
colliding in `docs/BACKLOG.md`). Tick a line when its pull request is open, and say where the
proof lives. The whole list, and what it means, is `docs/BACKLOG.md`.

- [ ] **מבצעים from the chains' own promotion files** as a second rung when the provider's feed is thin or one-sided. *price-portal-fixer*
- [ ] **Victory / Mahsanei HaShuk** price portal (laibcatalog postback answered "no files"). *price-portal-fixer*
- [x] **Promotions** (PromoFull files: club prices, multi-buys) lower the in-store total. The library side (`parsePromoFull`, `bestDealTotal`, `promoFile` on every portal) landed earlier unwired; the refresher now fetches each indexed branch's promo file alongside its price file and the quote path prices every line the cheapest way, marking club-only deals (this PR). *price-portal-fixer*
