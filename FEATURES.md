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
- Event types: Conference, Meetup, Workshop, Dinner, Party, Other

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
- Create labels (up to 10, max 20 chars each)
- Filter contacts by label
- Manage labels (create/delete)
- Assign up to 3 labels per contact

**Contact Cards** (`ContactsList`):
- Edit contact via `EditContactDialog`
- Delete contact with confirmation
- Handshake button (`HandshakeButton`) — initiate Proof of Handshake
- AI enrichment sparkle button — trigger `EnrichmentPanel`
- Contact details: name, company/position, telegram handle, email, notes, event, date met
- "Last contacted" timestamp tracking

**AI Contact Enrichment** (`EnrichmentPanel`):
- Trigger via sparkle button on contact card
- Uses Brave Search API + Claude Haiku to build a profile
- Displays: professional summary, current role, key achievements, social links, notable projects
- Confidence badge (high/medium/low)
- Regenerate button
- Usage tracking: 10 enrichments/month per user
- Expandable/collapsible panel inline on contact card

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
- Requires authenticated user (admin check inside component)

**Handshake Claim Page** (`?claim={id}`):
- Standalone page for claiming handshakes from shared links
- On completion, redirects to Dashboard tab

**Login Page** (`Login`):
- Shown when not authenticated
- Supabase auth (Google OAuth, email/password)

---

## Telegram Bot

**Webhook**: `api/telegram/webhook.ts`
**Flows**: `api/telegram/_flows/` (underscore = not a Vercel function)

### Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message + account linking (with link code from web app) |
| `/start {linkCode}` | Links Telegram account to existing web account |
| `/newcontact` | Add a new contact — pick from Telegram contacts or enter manually |
| `/contacts` | Browse contacts — "All Contacts" (with date filter + pagination) or by itinerary/event |
| `/handshake` | Initiate a Proof of Handshake (interactive contact picker) |
| `/handshake @handle` | Initiate handshake with specific Telegram user |
| `/enrich` | AI-enrich a contact (shows picker, or auto-enriches last saved contact) |
| `/enrich @handle` | Enrich contact by Telegram handle |
| `/help` | Show available commands |

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

**Forward Message Handling**:
- Forwarded messages in bot are parsed for contact info
- Can create contacts from forwarded Telegram messages

**Account Linking** (`/start {code}`):
- Links Telegram user to web account
- Computes initial trust score from Telegram signals
- Synthetic email: `tg_{telegramId}@telegram.convenu.xyz`

### Callback Prefixes (for inline keyboards)

`it:`, `ev:`, `cf:` (contact confirm), `ed:`, `yc:`, `ye:`, `xi:`, `xl:`, `xd:`, `xt:`, `xc:`, `xe:`, `iv:`, `tg:`, `fw:`, `fn:`, `hs:`, `cl:`, `ce:`, `cd:` (contacts date-filter), `cv:`, `cx:`, `en:`

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
| Google Calendar | Import events from Google Calendar |

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
| `useEnrichment` | `src/hooks/useEnrichment.ts` | Enrichment data + usage tracking |
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
