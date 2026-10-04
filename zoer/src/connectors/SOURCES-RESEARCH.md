# BC procurement sources beyond BC Bid, CanadaBuys and bids&tenders

Checked 2026-10-03 with plain HTTP GETs (User-Agent `ZoerProcurement/0.1; research`, a few requests per host, robots.txt
read first). Nothing behind a login or a bot challenge was bypassed. "Collect" means it fits Zoer's `network.fetch`:
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
| City of Surrey | surrey.ca/business-economy/tenders-rfqs-rfps?status=191 | Surrey | Drupal cards, 10 per page (`rel="next"`) + notice pages | free text "2:00pm local time" → instant in America/Vancouver; "submissions can be received at any time" → text only | card tag | name, phone (emails are Cloudflare-obfuscated and **not** decoded) | notice page files; most tenders are issued through BC Bid (expect duplicates) |

All six: robots.txt allows the paths, no challenge, 200 on a cold GET. Requests per portal ≤ 31 (2 list URLs × 3 pages +
25 notice pages). Hosts added to the allowlist: `rdn.bc.ca, www.srd.ca, www.penticton.ca, www.fernie.ca, www.fvrd.ca,
www.surrey.ca` (33 of 64 used after merging bids&tenders). No `networkSession` needed.

## Link only

| Source | URL | Buyers | Why not collected |
|---|---|---|---|
| CivicInfo BC Bids & Tenders | civicinfo.bc.ca/bids | BC local governments that post there (23 current on 2026-10-03, e.g. Penticton, Vernon, Esquimalt, Victoria, Surrey) | Cloudflare managed challenge ("Just a moment…", 403) on every page including `/bids-rss`, for non-browser clients. Loads for a person in Chrome. robots.txt itself would allow `/bids` (Crawl-delay 5). |
| City of Vancouver (Jaggaer) | bids.sciquest.com/apps/Router/PublicEvent?CustomerOrg=CityofVancouver | City of Vancouver | Server-rendered with every field (title, description, open/close time **with PDT/PST**, type, number, contact name + email) — technically ideal — but `robots.txt` is `User-agent: * / Disallow: /`. vancouver.ca itself answers automated requests with a Cloudflare block page. |
| Bonfire portals | `<org>.bonfirehub.ca/portal/?tab=openOpportunities` | Victoria, Saanich, Central Saanich, North Cowichan, CVRD, Courtenay, Comox, Vernon, Kelowna, UVic, VIU, BC Transit, ICBC, Island Health, Fraser Health, PHSA, FNHA (all answered 200 with their name) | The open list's JSON (`/PublicPortal/getOpenPublicOpportunitiesSectionData`) answers without login, but `robots.txt` is `Disallow: /` for all agents. Documents need a vendor account. `powellriver.bonfirehub.ca` does not resolve. |
| City of Port Alberni | portalberni.ca/bid-opportunities | Port Alberni | Hand-edited table: closing dates without times, no notice pages, nothing open on 2026-10-03. |
| District of Port Hardy | porthardy.ca/municipal-hall/staff/tender-and-bid-opportunities/ | Port Hardy | WordPress posts with title + posted date only; two cooperative-purchasing notices of intent. |
| City of White Rock, CSRD | whiterockcity.ca/Bids.aspx, csrd.bc.ca/Bids.aspx | White Rock, Columbia Shuswap RD | CivicPlus bid postings; no open bids, so a parser could not be checked against a live notice. The module's RSS (`RSSFeed.aspx?ModID=76`) returns the site's page feed, not bids. |

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
