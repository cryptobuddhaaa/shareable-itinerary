# Convenu Feature Map

> Living document — update as features are added, changed, or removed.

## App Overview

Convenu is an event itinerary + networking app with Web3 "Proof of Handshake" features. Two interfaces: **React SPA** (5-tab layout) and **Telegram Bot** (command-based).

---

## Web App (React SPA)

### Global UI

- **Header**: Logo, app name, wallet button, share button (when itinerary selected), user avatar + name, sign-out
- **Navigation**: Desktop = top tab bar; Mobile = bottom nav bar with icons
- **Pull-to-refresh**: Touch gesture refreshes itineraries + contacts
- **Keyboard shortcut**: `n` to create new itinerary (on itinerary tab) or new contact (on contacts tab)
- **Toast notifications**: Success/error/info toasts via custom `Toaster` component
- **Confirm dialogs**: Reusable confirmation pattern (`useConfirmDialog`)

---

### Tab 1: My Itineraries (`itinerary`)

**Component**: `ItineraryList` + `ItineraryTimeline` + `ItineraryForm`

**Features**:
- Create new trip itinerary (title, location, date range)
- List all itineraries with event counts, select to view
- Edit itinerary metadata (title, location, dates) via `EditItineraryDialog`
- Delete itinerary with confirmation
- Share itinerary via link (`ShareDialog`)
- Clone/duplicate itineraries

**Timeline View** (`ItineraryTimeline`):
- Day-by-day expandable cards
- "Today" quick-scroll button
- Event search/filter within itinerary
- Add events to days (manual or Luma import)
- Edit events via `EditEventDialog`
- Delete events (optionally with associated contacts)
- Event details: title, time, location, type, notes, Luma URL
- Location integration: "Open in Maps" link, day route URL (Google Maps directions)
- Print itinerary via `printService`
- Google Calendar import via `GoogleCalendarImport`
- Per-event contact list: see contacts met at each event
- Add contacts directly from an event context

**Event Form** (`EventForm`):
- Manual entry: title, date/time, location (name, address, coordinates), type, notes
- Luma event import: paste lu.ma URL, auto-fetches event details + location
- Event types: Meeting, Travel, Meal, Buffer, Accommodation, Activity, Side-event, Main-conference

**Share Dialog** (`ShareDialog`):
- Auto-generated shareable URL with copy button
- "Sharing X of Y days, N of M events" summary
- Selectively hide days or individual events from shared view
- "Update shared link" button

---

### Tab 2: Others' Itineraries (`shared`)

**Features**:
- View itineraries shared by other users via link
- List of previously viewed shared itineraries (persisted in localStorage)
- Click to view shared itinerary timeline (read-only)
- "Add to Mine" button to clone a shared itinerary into your own list
- Remove individual shared itineraries from list
- "Clear All" to remove all shared itineraries
- Standalone shared view for non-logged-in users (with "Get Started" CTA)
- Badge count on tab showing number of shared itineraries

---

### Tab 3: Contacts (`contacts`)

**Component**: `ContactsPage` + `ContactsList` + `ContactForm`

**Features**:
- Add new contact (first name, last name, company, position, telegram handle, email, notes, event association, date met)
- Contact list with cards showing name, company, event, tags, enrichment data
- Search contacts (name, company, position, event, email, telegram, tags)
- Sort by: Date Met, Last Contacted, First Name, Last Name
- Filter by tag/label
- Export contacts to CSV (with formula injection protection)
- Enrichment usage counter badge (used/limit)
- Telegram bot link/unlink integration

**Labels/Tags**:
- Create labels (up to 10 free / 25 premium, max 20 chars each)
- Filter contacts by label
- Manage labels (create/delete)
- Assign up to 3 labels per contact

**Contact Cards** (`ContactsList`):
- Edit contact via `EditContactDialog`
- Delete contact with confirmation
- Handshake button (`HandshakeButton`) — initiate Proof of Handshake
- AI enrichment sparkle button — trigger `EnrichmentPanel`
- Mark as contacted (clock icon — sets `lastContactedAt` timestamp; toggles to clear)
- Contact details: name, company/position, telegram handle (link to t.me), email (mailto), LinkedIn (link), notes, event, date met
- Tag chips (colored pill labels)
- Inline "Add note" input (max 200 chars, 10 notes per contact, timestamped)
- "Contacted X days/weeks ago" green indicator
- Handshake status inline (pending/claimed/matched/minted with Solana Explorer link)

**AI Contact Enrichment** (`EnrichmentPanel`):
- Trigger via sparkle button on contact card
- Uses Brave Search API + Claude Haiku (free) or Claude Sonnet (premium Enhanced AI) to build a profile
- Displays: professional summary, current role, key achievements, social links, notable projects
- Confidence badge (high/medium/low)
- Regenerate button with optional "Enhanced AI" toggle (premium only — uses Sonnet model for deeper analysis)
- Usage tracking: 10 enrichments/month (free) / 100 enrichments/month (premium)
- Expandable/collapsible panel inline on contact card
- Batch enrichment: "Enrich All" button enriches up to 10 unenriched contacts at once (premium only)

**vCard Export** (premium):
- Export contacts as `.vcf` file with name, company, position, email, telegram, linkedin, tags
- Available via "Export vCard" button in contacts toolbar

**Follow-Up Dialog** (`FollowUpDialog`):
- 4-step flow: Select contacts → Compose message → (optionally Create template) → Send
- Date filter presets: All, Today, Yesterday, This Week, This Month, Last 30 Days, Custom range
- Filter by trip + event
- Select/deselect individual contacts or select all
- Built-in message templates: Follow-up, Convenu Invite, Quick Hello, Collaboration
- Custom templates (up to 3, stored in localStorage)
- Template variables: `{firstName}`, `{lastName}`, `{company}`, `{eventMention}`
- Live message preview with variable substitution
- "Copy Message & Open DM" — copies message to clipboard (with textarea fallback for Telegram WebView) + opens Telegram DM
- Tracks `lastContactedAt` timestamp after sending

---

### Tab 4: Dashboard (`dashboard`)

**Component**: `Dashboard`

**Features**:

**Header Stats** (4 cards):
- Trust Score (out of 100)
- Total Points
- Minted Handshakes count
- Wallet address (or "Not linked")

**Trust Score Breakdown**:
- Overall score ring (0-100) with animated SVG
- Trust level badge: Newcomer (0-10), Verified (10-25), Trusted (25-40), Established (40-60), Champion (60+)
- 5 collapsible category sections with progress bars:
  - **Handshakes** (0-30): 1 pt per minted handshake, max 30
  - **Wallet** (0-20): Connected (+5), Age >90d (+5), Tx >10 (+5), Holds tokens (+5)
  - **Socials** (0-20): Telegram Premium (+4), Username (+4), Account age >1yr (+4), X verified (+4), X Premium (+4)
  - **Events** (0-20): Coming soon — Proof of Attendance soulbound NFTs
  - **Community** (0-10): Coming soon — organization vouches
- Sub-signal indicators (green dot = active, gray = inactive) with point values

**Handshake Status**:
- Counts by status: Pending, Matched, Minted (with colored bar charts)
- Recent handshakes list (up to 8)
- Status dots (yellow=pending, orange=claimed, blue=matched, green=minted)
- "Claim" button for pending handshakes where user is receiver
- "Minted Handshake" link to Solana Explorer for minted handshakes

**Points History**:
- Total points display
- Chronological list of point entries (reason, date, points earned)
- Links to Solana Explorer for handshake-related points

---

### Tab 5: Profile (`profile`)

**Component**: `ProfilePage`

**Linked Accounts Section**:
- **Email**: Display-only, green indicator when present
- **Google**: Connection status based on OAuth provider
- **Telegram**: Link/unlink via deep link code generation; shows `@username` when linked
- **Wallet**: Connect + verify flow (see Wallet below); shows shortened address when verified
- **X / Twitter**: OAuth verification flow; shows handle when verified; Disconnect option

**Profile Information Form**:
- Editable fields: First Name, Last Name, Company, Position, Bio (2000 char max), X/Twitter handle, LinkedIn URL, Website URL
- All fields: 500 char max (bio: 2000)
- Auto-fills from user metadata (splits full_name into first/last)
- Save button with loading state

**Wallet Connection** (`WalletButton`):
- Desktop: Phantom wallet extension via `@solana/wallet-adapter-react`
- Mobile/Telegram: Magic login link copied to clipboard → paste in Phantom browser
- Verification: Sign message `"Verify wallet ownership for Convenu\nUser: {userId}\nTimestamp: {ts}"`
- Permanent binding: one verified wallet per user, one user per wallet
- Disconnect only cleans up unverified entries; verified wallets stay bound

**X OAuth Verification** (`api/auth/x.ts`):
- PKCE + HMAC-signed state tokens (10-min expiry)
- Scopes: `tweet.read users.read offline.access`
- Detects X Premium (blue checkmark)
- Uniqueness: one X account per Convenu user
- Revokes refresh token on disconnect

**Subscription Section**:
- Shows current tier (Free/Premium) with badge
- Free users: feature comparison + "Upgrade to Premium" button → opens `UpgradeModal`
- Premium (Stripe): "Manage Subscription" button → Stripe Customer Portal
- Premium (Solana/Stars): Expiration date + "Renew" button
- Premium (Admin-granted): "Gifted by admin" note

---

### Premium Subscription (`UpgradeModal`)

**Tiers**: Free / Premium ($5/month or $45/year — save $15)

**Free Tier Limits**:
- 10 itineraries, 20 events/itinerary, 100 contacts
- 10 AI enrichments/month (Haiku only)
- 10 tags, 3 custom templates, 10 notes/contact
- No batch enrichment, no vCard export, no enhanced AI

**Premium Features**:
- Unlimited itineraries, events, contacts, notes
- 100 AI enrichments/month
- Enhanced AI toggle (Sonnet model for deeper profiles)
- Batch enrichment (up to 10 contacts at once)
- vCard export (.vcf)
- 25 tags, 10 custom templates

**Payment Providers**:
- **Stripe** (card): Auto-renewal via Checkout Sessions + Customer Portal for management
- **Solana Pay**: Manual renewal, SOL amount calculated from CoinGecko USD price (5-min cache)
- **Telegram Stars**: Manual renewal via Bot API invoicing (350 Stars/month, 3000 Stars/year)
- **Admin Grant**: Super admin can upgrade users to premium (perpetual unless time-limited)

**Renewal Behavior**:
- Stripe: auto-renews, webhook handles cancel/failure → downgrade
- Solana/Stars: manual renewal, expiry tracked via `current_period_end`

---

### Handshake Flow (Proof of Handshake)

**Initiation** (`HandshakeButton` on contact card):
1. User clicks "Handshake" on a contact (requires contact to have telegram or email)
2. Confirmation dialog explains the flow + 0.01 SOL fee
3. Creates pending handshake record via API
4. Builds SOL transfer transaction (0.01 SOL to treasury wallet)
5. User signs transaction in wallet
6. Transaction confirmed → handshake moves to "pending" with tx signature

**Claim** (`HandshakeClaimPage`):
1. Receiver opens claim link (`?claim={handshakeId}`)
2. Must log in / create account
3. Reviews handshake details
4. Signs their own 0.01 SOL transaction
5. Both signatures confirmed → status moves to "matched"

**Mint**:
1. Either party clicks "Mint" on a matched handshake
2. Server mints two soulbound cNFTs on Solana (one per participant)
3. Status → "minted", NFT addresses stored
4. Points awarded to both parties

**Telegram Handshake** (alternative flow):
- `/handshake @handle` or `/handshake` (interactive contact picker)
- Same flow but through Telegram bot interface

---

### Special Pages

**Admin Dashboard** (`/admin`):
- Accessible via `/admin` URL path
- Requires authenticated user (admin check via `admin_users` table)
- **Overview**: Key metrics (total users, DAU/WAU/MAU, stickiness %, handshake counts, wallet stats, contacts, itineraries, points, Telegram-linked users)
- **Users**: Searchable paginated user table with trust score, wallet, X, Telegram per row; drill-down to user detail with upgrade/downgrade buttons
- **Handshakes**: Filterable list (by status, date) + funnel visualization (pending → matched → minted)
- **Events**: Top events by handshake count
- **Trust**: Score distribution histogram + per-tier averages
- **Signups**: Daily signup trend chart

**Handshake Claim Page** (`?claim={id}`):
- Standalone page for claiming handshakes from shared links
- On completion, redirects to Dashboard tab

**Login Page** (`Login`):
- Shown when not authenticated
- "Sign in with Google" button (OAuth via Supabase)
- "Sign in with Telegram" button (shown only inside Telegram Mini App, uses `initData`-based JWT)

**Handshake Claim Page** details:
1. Not logged in → prompt to sign in
2. Logged in, no wallet → generate magic link for wallet browser (preserves `?claim=` in URL)
3. Wallet connected but not verified → auto-runs verify flow (sign message)
4. Wallet verified → show initiator name + fee info → sign 0.01 SOL transaction
5. Both parties paid → auto-triggers minting
6. Success screen with points earned → "Go to app" returns to Dashboard

---

## Telegram Bot

**Webhook**: `api/telegram/webhook.ts`
**Flows**: `api/telegram/_flows/` (underscore = not a Vercel function)

### Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message; with link code, links Telegram to web account |
| `/newcontact` | Add a new contact — pick from Telegram contacts or enter manually |
| `/newitinerary` | Create a new trip (title, dates, location, goals) |
| `/newevent` | Add an event to a trip (manual or Luma URL import) |
| `/contacts` | Browse contacts — "All Contacts" (date filter + pagination) or by itinerary/event |
| `/contacted @handle` | Mark a contact as reached out to |
| `/itineraries` / `/events` | Browse trips and events |
| `/today` | Show today's events across all trips |
| `/handshake [@handle]` | Initiate a Proof of Handshake (interactive picker or direct) |
| `/enrich [@handle]` | AI-enrich a contact (picker, auto-enriches last saved, or by handle/name) |
| `/trust` | View full trust score breakdown (ASCII bar chart) |
| `/points` | View points balance and recent history |
| `/shakehistory` | View handshake history with status |
| `/subscribe` | Upgrade to Premium via Telegram Stars payment |
| `/cancel` | Cancel current conversation state |
| `/help` | Show available commands with "Open App" button |

### Key Bot Features

**Contact Picker** (`/newcontact`):
- "Pick from Telegram" button uses Bot API 7.0+ `KeyboardButtonRequestUsers`
- Auto-fills handle + first/last name from Telegram profile
- `goToNextField()` skips pre-filled fields
- "Enter manually" falls back to field-by-field flow
- Fields: itinerary → event → first name → last name → company → position → telegram → email → notes
- After save, suggests `/enrich` with auto-enrichment of last contact

**Contacts Browse** (`/contacts`):
- "All Contacts" → date filter menu (Today, Last 3 Days, Last Week, Last Month, All Time)
- Paginated at 10 per page with "More ›" button
- Itinerary/event-scoped views bypass date filter
- Callback prefix: `cd:` (contacts date-filter)

**Contact Enrichment** (`/enrich`):
- Same `performEnrichment()` pipeline as web app
- Formatted Telegram message with profile summary
- "Regenerate" button
- Auto-enriches last saved contact from `/newcontact` flow

**Forward Message Handling** (`forward.ts`):
- Forwarded messages in bot are parsed for sender info (handle, name)
- Supports Bot API 7.0+ `forward_origin`, legacy `forward_from`, privacy-restricted `forward_sender_name`
- Checks if sender already exists in contacts (by handle, then by name)
  - If exists: offers "Add as note" (saves message text as timestamped note, max 10/contact) or "Create new contact anyway"
- If new: auto-matches forward date to closest itinerary event
- Shows event confirmation: "Is this the right event?" with yes/pick different/no event options
- Creates contact linked to selected itinerary/event

**Itinerary/Event Creation** (bot):
- `/newitinerary`: Sequential fields — title, start date, end date, location, goals (optional); confirmation with edit keyboard
- `/newevent`: Select itinerary → paste Luma URL or enter manually → select day, type, title, location, times; confirmation with edit keyboard

**Trust & Points** (`trust-points.ts`):
- `/trust`: ASCII bar chart of all 5 categories + per-signal checkmarks
- `/points`: Total + last 10 point entries with dates and reasons
- `/shakehistory`: Paginated list of handshakes with status emojis (pending/matched/minted)

**Account Linking** (`/start {code}`):
- Links Telegram user to web account
- Computes initial trust score from Telegram signals
- Synthetic email: `tg_{telegramId}@telegram.convenu.xyz`

### Callback Prefixes (for inline keyboards)

`it:`, `ev:`, `cf:` (contact confirm), `ed:`, `yc:`, `ye:`, `xi:`, `xl:`, `xd:`, `xt:`, `xc:`, `xe:`, `iv:`, `tg:`, `fw:`, `fn:`, `hs:`, `cl:`, `ce:`, `cd:` (contacts date-filter), `cv:`, `cx:`, `en:`, `sb:` (subscribe)

---

## API Endpoints

### Profile (`api/profile/index.ts`)
| Method | Action | Description |
|--------|--------|-------------|
| GET | — | Fetch user profile |
| PUT | — | Save/update profile (allowlisted fields only) |
| POST | `?action=verify-wallet` | Verify wallet signature |
| POST | `?action=compute-trust` | Recompute trust score |
| POST | `?action=enrich` | AI contact enrichment |
| GET | `?action=enrich-usage` | Check enrichment usage |
| GET | `?action=telegram-status` | Check Telegram link status |
| POST | `?action=generate-link-code` | Generate Telegram link code |
| DELETE | `?action=unlink-telegram` | Unlink Telegram account |
| GET | `?action=subscription` | Get subscription status + tier + limits |
| POST | `?action=stripe-checkout` | Create Stripe Checkout session |
| POST | `?action=stripe-portal` | Create Stripe Customer Portal session |
| POST | `?action=stripe-webhook` | Stripe webhook handler (no auth) |
| POST | `?action=solana-checkout` | Get SOL amount for subscription payment |
| POST | `?action=solana-confirm` | Verify on-chain SOL payment, activate subscription |
| POST | `?action=batch-enrich` | Batch enrich up to 10 contacts (premium only) |
| GET/POST | `?action=admin-*` | Admin panel data (admin-gated) |
| POST | `?action=admin-upgrade-user` | Admin: upgrade user to premium |
| POST | `?action=admin-downgrade-user` | Admin: downgrade user to free |

### Auth (`api/auth/index.ts`)
| Method | Action | Description |
|--------|--------|-------------|
| POST | `?action=wallet-login` | Generate magic wallet login link |
| POST | `?action=telegram` | Telegram Mini App auth |

### Auth / X (`api/auth/x.ts`)
| Method | Description |
|--------|-------------|
| POST | Initiate X OAuth flow |
| GET | Handle X OAuth callback |
| DELETE | Disconnect X account |

### Handshake (`api/handshake/index.ts`)
| Action | Description |
|--------|-------------|
| `?action=initiate` | Create pending handshake |
| `?action=confirm-tx` | Confirm transaction signature |
| `?action=claim` | Claim a pending handshake |
| `?action=mint` | Mint soulbound cNFTs |
| `?action=list` | List user's handshakes |

### Calendar (`api/calendar/`)
| Endpoint | Description |
|----------|-------------|
| GET `luma?url=` | Fetch and parse Luma event data (validates hostname) |
| GET `exchange` | Google Calendar OAuth token exchange |

### Telegram (`api/telegram/webhook.ts`)
| Endpoint | Description |
|----------|-------------|
| POST `/api/telegram/webhook` | Telegram Bot webhook handler |

---

## State Management (Zustand Stores)

| Store | File | Purpose |
|-------|------|---------|
| `useItinerary` | `src/hooks/useItinerary.ts` | Itineraries CRUD, current selection |
| `useContacts` | `src/hooks/useContacts.ts` | Contacts CRUD, tags, search |
| `useHandshakes` | `src/hooks/useHandshakes.ts` | Handshake lifecycle, lookups |
| `useUserWallet` | `src/hooks/useUserWallet.ts` | Wallet link/verify/unlink |
| `useEnrichment` | `src/hooks/useEnrichment.ts` | Enrichment data + usage tracking + batch |
| `useSubscription` | `src/hooks/useSubscription.ts` | Subscription tier, limits, payment actions |
| `useAuth` | `src/hooks/useAuth.tsx` | Auth context (Supabase session) |

---

## Services

| Service | File | Purpose |
|---------|------|---------|
| `shareService` | `src/services/shareService.ts` | Itinerary sharing (generate/load links) |
| `lumaService` | `src/services/lumaService.ts` | Fetch event data from lu.ma URLs |
| `mapsService` | `src/services/mapsService.ts` | Google Maps links + route URLs |
| `printService` | `src/services/printService.ts` | Print itinerary to PDF/paper |
| `googleCalendarService` | `src/services/googleCalendarService.ts` | Google Calendar event import |
| `telegramService` | `src/services/telegramService.ts` | Telegram link/unlink + status |

---

*Last updated: 2026-02-27*
