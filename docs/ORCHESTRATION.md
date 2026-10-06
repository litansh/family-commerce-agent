# How the orchestrator runs the fleet

The owner reports what they met. The orchestrator turns each report into a line in
`docs/BACKLOG.md` with an owning agent, sends that agent the evidence, and reviews what comes back.
No agent picks its own priorities while an owner-reported line of its own is open.

## Routing

| What was met | Owner |
|---|---|
| a store's site, a session, a cart recipe, a store's own data | store-recipe-fixer |
| the API, the domain, the provider ladder, resolution, tests | api-fixer |
| price files, portals, promotions | price-portal-fixer |
| the simulator's flows | sim-flow-fixer |
| a promise not kept, with real data | product-qa |
| how anything is shown or decided on a screen | app-designer |

## One file per agent

The worklist is split: `docs/backlog/<agent>.md`. An agent reads its own file and writes only there,
because two agents editing `docs/BACKLOG.md` at once made every second pull request unmergeable. The
orchestrator moves a line that turns out to belong to someone else, and keeps `docs/BACKLOG.md` as
the map.

## The evidence an agent is given

A report reaches an agent with what was measured, not with an adjective: the call that failed and
its timing, the log line, the screenshot, the exact basket. "Tofu is not found" becomes
"`search_products('טופו')` → `internal_error` after 20.7 s, from this Mac, at this hour".

## What comes back

One pull request per line, through `ops/pr.sh`, naming the line, the rung it adds (ADR 0010), and
the lab that proves it. A fix without a lab that would have caught the bug is not finished: the
same failure must turn a check red before a family meets it again.

## Running

`ops/lanes.sh` runs two lanes side by side, each lane serial. A single agent on a single line runs
with `FLEET_TASK="..." ops/fleet.sh <agent>`. The daily job (`ops/repair.sh`, 06:40) runs the checks,
repairs what is red, reviews the promises, then runs the lanes.
