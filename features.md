# Convenu — Feature Reference

## Itineraries (Trip Planning)

- Create, edit, delete, clone multi-day itineraries
- Add events per day with time, location, description, venue coordinates
- Day-level notes, goals, and checklist items
- Transit segments between locations
- Pin events to Google Maps with directions
- Import events from Google Calendar / Luma
- Search events within itinerary
- Print itinerary
- Share itinerary via view-only link (no auth required to view)

## Contacts (Networking)

- Add contacts manually or via Telegram bot contact picker
- Edit details: name, company, position, email, Telegram handle, LinkedIn, notes
- Assign contacts to itineraries/events
- Filter by itinerary, event, date, or search by name/tag
- Sort by date met, first name, last name, last contacted
- Duplicate detection by name, Telegram handle, email
- Custom tags (10 free, 25 premium)
- Notes per contact (10 free, unlimited premium)
- Quick link to open Telegram DM
- CSV export (all tiers)
- vCard (.vcf) export (premium only)

## Contact Enrichment (AI-Powered)

**Web:**
- Sparkle button triggers AI enrichment (name + context search)
- Returns summary, roles/positions, online profile links, confidence badge
- Regenerate with enhanced AI (Sonnet model, premium only)
- Batch enrich up to 10 unenriched contacts (premium only)
- Usage: 10/month free, 100/month premium

**Telegram Bot:**
- `/enrich` — pick contact from list
- `/enrich @handle` — enrich by Telegram handle
- `/enrich Name, Company` — free-form enrichment
- Regenerate button in chat
- After `/newcontact` save, tapping `/enrich` auto-enriches last saved contact

## Handshakes (Proof-of-Meeting on Solana)

- Select contact with email or Telegram handle
- Initiate handshake (0.01 SOL fee, signed via Phantom/Ledger)
- Receiver claims via link, signs to confirm
- Both confirmed → matched → mint soulbound cNFT on Solana devnet
- 10 trust points per minted handshake
- View NFT on Solana Explorer

## Follow-Up (Bulk Messaging)

1. **Select** — filter contacts by trip/event, date presets (Today, Yesterday, This Week, etc.), custom date range, paginated
2. **Compose** — 4 built-in templates + custom templates, variable chips ({firstName}, {company}, {eventTitle}, etc.), live preview
3. **Create Template** — save custom templates (3 free, 10 premium), with variable chips and preview
4. **Send** — copy message to clipboard + open Telegram DM (textarea fallback for WebView)

## Dashboard (Trust & Reputation)

- Trust score (0-100) across 5 categories: Handshake, Wallet, Socials, Events, Community
- Trust level badge: Novice, Established, Champion
- Telegram status (premium, account age, username)
- Wallet status (connected, balance, age, transaction history)
- Points history and handshake history

## Profile & Auth

- Edit profile (name, company, position, bio, Twitter, LinkedIn, website)
- Link Telegram account via bot `/start` code
- X (Twitter) OAuth verification
- Solana wallet connect + signature verification (Phantom, Ledger)
- View subscription tier, limits, renewal date
- Stripe billing portal

## Telegram Bot

- `/start [link_code]` — link Telegram to web account
- `/newitinerary` — create trip
- `/newcontact` — add contact (Telegram picker or manual entry)
- `/contacts` — browse with date filter + pagination (10 per page)
- `/enrich` — AI contact enrichment
- `/handshake` — initiate proof-of-meeting
- `/subscribe` — view pricing, pay with Telegram Stars

## Subscriptions & Payments

**Free Tier:**
| Feature | Limit |
|---------|-------|
| Itineraries | 10 |
| Events per itinerary | 20 |
| Contacts | 100 |
| Enrichments/month | 10 |
| Tags | 10 |
| Templates | 3 |
| Notes per contact | 10 |
| AI model | Haiku |
| Batch enrich | No |
| vCard export | No |

**Premium Tier ($5/month or $45/year):**
| Feature | Limit |
|---------|-------|
| Itineraries | Unlimited |
| Events per itinerary | Unlimited |
| Contacts | Unlimited |
| Enrichments/month | 100 |
| Tags | 25 |
| Templates | 10 |
| Notes per contact | Unlimited |
| AI model | Sonnet (enhanced) |
| Batch enrich | Yes (10 at a time) |
| vCard export | Yes |

**Payment Methods:**
- Stripe (card) — checkout + billing portal
- Solana Pay (SOL) — CoinGecko live pricing, wallet transfer, on-chain verification
- Telegram Stars — in-bot payment via `/subscribe`
- Admin grants — perpetual or time-limited

## Social Integrations

- **Google Calendar** — OAuth, import Luma events to itinerary
- **X (Twitter)** — OAuth, verified badge, trust score signal
- **Telegram** — bot integration, contact picker, Stars payments
- **LinkedIn** — URL stored on contacts, used in enrichment context

## Admin Dashboard

- Overview metrics: users, DAU/WAU/MAU, handshakes, wallets, contacts, subscriptions
- User management: searchable table, drill-down, upgrade/downgrade tier, grant premium
- Handshake analytics: funnel (Initiated -> Claimed -> Matched -> Minted), status distribution
- Event analytics: top events by handshake count
- Trust score distribution: histogram, category averages
- Signup trends: daily chart
