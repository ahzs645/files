# BC procurement sources beyond BC Bid, CanadaBuys and bids&tenders

Checked 2026-10-03 with plain HTTP GETs (User-Agent `ZoerProcurement/0.1; research`, at most 3 requests per host, robots.txt
read first; ~110 BC buyers surveyed). Nothing behind a login or a bot challenge was bypassed. "Collect" means it fits Zoer's `network.fetch`:
GET only, no redirects, no cookies, no scripts, exact allowlisted hosts.

Verdicts: **connector** (built, in `municipal-sites.ts`), **link only** (listed in `dashboard/procurement/link-sources.ts`
for people to check), **skip** (covered by another source or not procurement).

## Built: `municipal-sites` (own-website listings)

| Source | Listing URL | Buyers | Access | Closing time + zone | Status | Contacts | Documents |
|---|---|---|---|---|---|---|---|
| Regional District of Nanaimo | rdn.bc.ca/current-bid-opportunities | RDN | Drupal table, 1 page; notice pages `/node/<id>` | `<time datetime="…Z">` checked against printed time → instant. In winter RDN prints 1:00 AM beside 00:00 PST, so those keep the date only | not printed; derived from a verified instant (`statusDerivedFrom`) | notice body (name, role, email) | notice page file links |
| Strathcona Regional District | srd.ca/government/bid-opportunities?status=66 and =67 | SRD | Drupal table; "Open" and "Open - Amended" are separate filters | `<time datetime>` → instant | column | — | rows carry no links (keyed by notice number, else title) |
| City of Penticton | penticton.ca/…/open-bid-opportunities | Penticton | Drupal table (open only) + notice pages | time-only `<time>` checked with the date beside it → instant | "Open" (list) | none published | notice page files |
| City of Fernie | fernie.ca/EN/main/business/bid-opportunities.html | Fernie | eSolutions table + notice pages; RSS exists but has no closing dates | printed without zone (Fernie is on Mountain Time) → date only | column | notice page (name, role, phone, email) | civicweb file links |
| Fraser Valley RD | fvrd.ca/EN/main/government/tenders-rfps.html | FVRD | eSolutions table (open + recently closed) + notice pages | no zone → date only | column | notice page | notice page files, incl. addenda |
| City of Courtenay | courtenay.ca/business-and-building/business-resources/doing-business-city/bid-opportunities | Courtenay | Up&Up Drupal table (title header empty) + notice pages | `<time datetime="…Z">` → instant | column | notice page (name, email) | notice page files |
| Township of Esquimalt | esquimalt.ca/business-development/bids-tenders | Esquimalt | Up&Up Drupal table + notice pages | `<time datetime>` → instant | column (incl. "Evaluating") | — | — |
| City of Quesnel | quesnel.ca/business-services/doing-business-city/bid-opportunities?bid_status=54 (Open; unfiltered it pages closed notices 8 at a time) | Quesnel | Up&Up Drupal **list** view + notice pages | `<time datetime>` → instant ("Application deadline"; its second "Application deadline" is the open-until-filled switch and is ignored) | field | — | — |
| Town of Comox | comox.ca/opportunities | Comox | CiviKit Drupal list view + notice pages | `<time datetime>` → instant | not printed; derived from the verified instant | — | notice page `/media/<id>` links; most also on BC Bid |
| District of Saanich | saanich.ca/EN/main/business/selling-to-saanich/bid-opportunities.html | Saanich | eSolutions table (62 rows incl. closed) + notice pages; RSS `…/data/tenders.rss` exists but the table has more fields | no zone → date only | column | notice page (purchasing email) | documents and submissions on Saanich's Bonfire (link only) |
| City of Dawson Creek | dawsoncreek.ca/business-development/tenders/ | Dawson Creek | GovStack table with separate closing date and time columns (joined) | no zone → date only (Dawson Creek is MST all year) | column (some "N/A") | — | links go to `/news/posts/…` |
| City of Surrey | surrey.ca/business-economy/tenders-rfqs-rfps?status=191 | Surrey | Drupal cards, 10 per page (`rel="next"`) + notice pages | free text "2:00pm local time" → instant in America/Vancouver; "submissions can be received at any time" → text only | card tag | name, phone (emails are Cloudflare-obfuscated and **not** decoded) | notice page files; most tenders are issued through BC Bid (expect duplicates) |

All twelve: robots.txt allows the paths (no Crawl-delay or Visit-time), no challenge, 200 on a cold GET at the listed URL
(no redirect hop). Requests per portal ≤ 31 (2 list URLs × 3 pages + 25 notice pages); only notices the listing does not
already show as closed get a notice-page request. Hosts added to the allowlist: `rdn.bc.ca, www.srd.ca, www.penticton.ca,
www.fernie.ca, www.fvrd.ca, www.surrey.ca, www.courtenay.ca, www.esquimalt.ca, www.quesnel.ca, www.comox.ca, www.saanich.ca,
www.dawsoncreek.ca` (39 of 64 used with bids&tenders). No `networkSession` needed.

`closingAt` rule (needs the contract owner's agreement, see CONNECTORS.md §3): an ISO instant only when the page states the
zone (machine-readable `<time>` that matches the printed wall-clock time in the buyer's zone, or "local time"/"PT"/"PDT" in
words). When only the date can be trusted, `closingAt` is the date alone (`YYYY-MM-DD`), which `deadline.ts` already treats
as "closing date; time unverified"; `closingDate` always keeps the source text. Status, when a site prints none, is derived
only from a verified instant and marked `statusDerivedFrom: 'closingAt'`; otherwise it is `Unknown`.

## Link only (`link-sources.ts`)

Every URL below loaded for a person on 2026-10-03 (curl 200, or system Chrome for challenge-blocked pages).

| Source | Buyers | Why not collected |
|---|---|---|
| CivicInfo BC (civicinfo.bc.ca/bids) | BC local governments that post there (23 current, e.g. Penticton, Vernon, Esquimalt, Victoria, Surrey) | Cloudflare managed challenge on every page including `/bids-rss` for non-browser clients. robots.txt itself would allow `/bids` (Crawl-delay 5). |
| City of Vancouver (Jaggaer, bids.sciquest.com) | Vancouver | Server-rendered with every field incl. PDT/PST closing times and contacts, but robots.txt is `Disallow: /` for all agents; vancouver.ca blocks automated requests. |
| Bonfire portals (`<org>.bonfirehub.ca`) | Victoria, Saanich, Central Saanich, North Cowichan, CVRD, Courtenay, Comox, Vernon, Kelowna, UVic, VIU, BC Transit, ICBC, Island Health, Fraser Health, PHSA, FNHA | Open-list JSON (`/PublicPortal/getOpenPublicOpportunitiesSectionData`) answers without login, but robots.txt is `Disallow: /`. The old code needed login + Cloudflare bypass for details; not done. |
| Kelowna site, West Vancouver, RDKB, YVR, Port of Vancouver, Cranbrook | those buyers | Cloudflare or bot-challenge (403 / challenge script) for non-browser requests. |
| BC Ferries procurement | BC Ferries | robots.txt `Crawl-delay: 10` and `Visit-time: 0900-1200` UTC. A collection run reads a listing then notice pages back to back and runs on the user's schedule, so it cannot honour either; the old code also needed a BC Ferries login. |
| Chilliwack, Whistler | those buyers | robots.txt `Crawl-delay: 10` (Whistler also disallows its PDFs). Same reason as BC Ferries. |
| Port Alberni, Port Hardy, qathet, Terrace | those buyers | No closing times or no closing dates, hand-edited lists, or no notice pages. |
| SCRD, Hope ("Pacific Time"), Smithers ("PST"), ACRD, Pemberton | those buyers | One-off WordPress/custom pages; feasible later as single-portal parsers, not built in this pass. |
| SLRD | SLRD | One notice in a table whose only date column is headed "Date" (closing vs posted unclear). |
| Oliver (Up&Up template), White Rock, CSRD, Williams Lake, Nelson, Salmon Arm (CivicPlus `Bids.aspx`) | those buyers | Nothing open on 2026-10-03, so no parser could be checked against a live notice. Oliver can be added as a `table` portal once it posts one. CivicPlus's bids RSS (`RSSFeed.aspx?ModID=76`) returned the sites' page feeds, not bids. |

The survey's own requests broke the crawl delay on Chilliwack, Whistler and BC Ferries (3 requests ~3 s apart) and BC
Ferries' visit window; the connector does not touch those hosts.

## Skip

| Source | Why |
|---|---|
| Capital Regional District (bid.crd.ca) | Portal "no longer actively updated as of June 25, 2026"; CRD posts on BC Bid. |
| RDN RSS (rdn.bc.ca/rss) | The old code's feed is the "Service Alerts" news feed, not bids; the bids page above is used instead. |
| Destination BC | Every listing links to BC Bid. |
| Regional District of North Okanagan | "All opportunities are available for review on BC Bid." |
| RDOS tenders page | News-style page; opportunities are on BC Bid. |
| City of Vernon (vernon.ca list) | Points to its Bonfire portal for details (link only above); Vernon is also on bids&tenders. |
| Prospero sites (online.saanich.ca, tender.victoria.ca, prospero.courtenay.ca, …) in can-1-final | Development/permit applications, not procurement. |
| BC Ferries business-ops | Behind a BC Ferries login in the old code. |
| Pitt Meadows | Its table's only link column is "BC Bid Link": covered by BC Bid. |
| Kamloops, Delta, New Westminster, Township of Langley, Maple Ridge, Port Moody, Merritt, Summerland, Interior Health, Fraser Health, BC Hydro, BC Housing, PHSA, Osoyoos, TNRD, RDEK, Prince Rupert, Colwood, Castlegar, Harrison, SD61, VSB, UBC, BCIT, VCC, North Cowichan, North Saanich, Victoria, Mission, Fort St. John, Powell River | Their bid pages point to BC Bid, bids&tenders or Bonfire (by links on the page, 2026-10-03), which are covered or listed above. |

| Not classified in this pass | Bowen Island, Cariboo RD, City of North Vancouver, Duncan, Gibsons, Golden, Kimberley, Ladysmith, Langford, Parksville, Qualicum Beach, PRRD, Trail, View Royal, Surrey Schools, TransLink, VCH answered 200 without a link to a known platform; each needs its own look. City of Langley, Kitimat and RDCK bid URLs returned 404. |

## Live check of the connector (2026-10-03)

One `collectPortal` run per portal against the live sites, 2.5 s between requests, no redirects followed:

| Portal | Requests | Records | Status Open | Zoned `closingAt` | With contacts | Warnings |
|---|---|---|---|---|---|---|
| rdn | 4 | 11 | 3 | 11 | 3 | — |
| srd | 2 | 0 | 0 | 0 | 0 | — (nothing open) |
| penticton | 4 | 3 | 3 | 3 | 0 | — |
| fernie | 2 | 1 | 1 | 0 | 1 | — |
| fvrd | 3 | 6 | 2 | 0 | 2 | — |
| courtenay | 4 | 7 | 3 | 7 | 3 | — |
| esquimalt | 4 | 16 | 5 | 16 | 0 | — |
| quesnel | 6 | 24 | 6 | 24 | 0 | more than 3 pages (fixed: list URL now filters to Open) |
| comox | 3 | 2 | 2 | 2 | 0 | — |
| saanich | 6 | 62 | 9 | 0 | 5 | — |
| dawsoncreek | 3 | 23 | 1 | 0 | 0 | 2 `/news/posts` notice pages unrecognized |
| surrey | 15 | 13 | 13 | 8 | 13 | — |

Some sites keep "Open" on notices whose closing date passed long ago (Quesnel lists two from December 2025); the
dashboard's deadline judgement uses `closingAt`, and no notice page is fetched for them.

## Appendix: survey method

Raw responses are not kept in the repo. Each host got its robots.txt plus one or two page requests, ≥ 2 s apart. Pages
that redirected were re-fetched at the `Location`; connector `listUrls` are the final URLs, so no run spends a request on a
redirect hop.
