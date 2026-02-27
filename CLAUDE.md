# CLAUDE.md — Convenu Codebase Guide

## Project Overview

Convenu is an event itinerary + networking app with Web3 "Proof of Handshake" features. Users plan trips, add contacts met at events, and mint soulbound cNFTs on Solana as proof-of-meeting.

**Stack:** React 19 + Vite (SPA), Vercel serverless functions, Supabase (auth + Postgres), Solana (devnet), Telegram Bot + Mini App, Brave Search API + Claude Haiku (contact enrichment).

## Architecture

```
src/           → React SPA (Vite, Tailwind, Zustand)
api/           → Vercel serverless functions (Node.js)
api/_lib/      → Shared server utilities (auth, wallet enrichment, telegram age, contact enrichment)
api/telegram/  → Telegram bot webhook + flows
sql/           → Database migrations (run in Supabase SQL Editor)
```

### Key Patterns

- **SPA with tab navigation** — No client-side router. `App.tsx` uses `activeTab` state. The `vercel.json` rewrite `/((?!api/).*) → /index.html` ensures deep links work.
- **Consolidated endpoints** — Vercel Hobby plan limits to 12 functions. `api/handshake/index.ts` uses `?action=` routing. `api/profile/index.ts` consolidates profile CRUD, admin actions, and contact enrichment via `?action=` params. Telegram flows are split into `_flows/` (underscore prefix = not a Vercel function).
- **Auth** — Supabase JWT via `Authorization: Bearer` header. All API endpoints use `requireAuth()` from `api/_lib/auth.ts`. Telegram users get synthetic emails (`tg_<id>@telegram.convenu.xyz`).
- **Trust scores** — Written from 3 paths: bot `/start` linking (`account.ts`), Mini App login (`auth/telegram.ts`), and Dashboard recompute (`trust/compute.ts`). All 3 must stay in sync.
- **Wallet verification** — Users sign a message containing their user ID + timestamp. Server verifies via `tweetnacl`. Uniqueness enforced: one verified wallet per user, one user per wallet.
- **Telegram contact picker** — `/newcontact` flow uses Bot API 7.0+ `KeyboardButtonRequestUsers` to let users pick a contact from their Telegram list, auto-filling handle + first/last name. Falls back to manual field-by-field entry. `goToNextField()` skips pre-filled fields automatically.
- **Follow-Up (bulk messaging)** — `FollowUpDialog.tsx` (formerly `InviteDialog.tsx`) is a 4-step dialog: select contacts (filter by trip + date) → compose message (template + variables) → create custom template (separate screen) → send (copy to clipboard + open DM). Clipboard uses textarea fallback for Telegram WebView compatibility.

## Build & Dev

```bash
npm run dev        # Vite dev server with API plugin (serves api/ locally)
npm run build      # tsc -b && vite build
npx tsc -b --noEmit  # Type-check only
```

## Database

- RLS enabled on all tables. All policies use `(select auth.uid())` pattern for performance.
- Trust-sensitive tables (handshakes, user_points, trust_scores) have no client-side UPDATE/INSERT policies — all writes go through service role key.
- SQL functions use `SET search_path = ''` and `SECURITY DEFINER` with `auth.uid()` checks.

## Environment Variables

**Required for API:**
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — Supabase admin access
- `TELEGRAM_BOT_TOKEN` — Telegram Bot API
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — Client-side Supabase
- `VITE_SOLANA_RPC_URL` — Solana RPC (Helius/QuickNode)
- `VITE_TREASURY_WALLET` — SOL fee recipient

**Required for Stripe payments:**
- `STRIPE_SECRET_KEY` — Stripe API key
- `STRIPE_WEBHOOK_SECRET` — Stripe webhook signing secret
- `STRIPE_PRICE_ID_MONTHLY` — Stripe Price ID for $5/month plan
- `STRIPE_PRICE_ID_ANNUAL` — Stripe Price ID for $45/year plan

**Optional:**
- `BRAVE_SEARCH_API_KEY` — Brave Search API for contact enrichment (free tier: 2,000 queries/month)
- `ANTHROPIC_API_KEY` — Claude Haiku/Sonnet for contact enrichment LLM summarization
- `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_CALLBACK_URL` — X OAuth
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` — Google Calendar
- `HANDSHAKE_TREE_KEYPAIR`, `HANDSHAKE_MERKLE_TREE` — cNFT minting
- `WEBAPP_URL` — Defaults to `https://app.convenu.xyz`

## Security Notes

- Profile updates use allowlist (`ALLOWED_FIELDS`) + length limits
- Luma URL fetching validates hostname against `lu.ma` / `luma.com` only
- X OAuth uses HMAC-signed state tokens (no cookies) with 10-min expiry
- Wallet verification has timestamp-based replay protection (5-min window)
- Handshake claim uses atomic status check (`eq('status', 'pending')` in update) to prevent TOCTOU races
- HTML entities in Luma event data are decoded via `decodeHtmlEntities()` — not used for rendering (API only returns JSON)
- Contact enrichment: name/context inputs are truncated (200/500 char limits). Enrichment writes use service role key only. Usage tracked per-user per-month with enforced limits.

## Common Pitfalls

1. **Trust score writes** — Three separate code paths write to `trust_scores`. When adding a new signal, update all three: `api/auth/telegram.ts`, `api/telegram/_flows/account.ts`, and `api/trust/compute.ts`.

2. **Telegram Bot API vs initData** — The Bot API `User` object has different fields than the Mini App `WebAppUser`. Notably, `has_profile_photo` does NOT exist on Bot API `User` — use `getUserProfilePhotos` API instead.

3. **Vercel function limit** — Hobby plan allows 12 serverless functions. Files in `api/telegram/_flows/` and `api/_lib/` use underscore prefix so Vercel doesn't count them as endpoints.

4. **SPA routing** — Any new pages that might be navigated to via external redirects (like OAuth callbacks) need: (a) the `vercel.json` rewrite already handles this generically, and (b) `App.tsx` needs a `useEffect` to detect the URL params and switch tabs.

5. **Supabase upsert behavior** — When upserting to `trust_scores` with `onConflict: 'user_id'`, only the specified columns are updated on conflict. Other columns retain their values. This is correct — partial upserts are safe.

6. **vite.config.ts dev server** — The `vercelApiPlugin` simulates Vercel's runtime locally. It supports `req.query`, `res.json()`, `res.redirect()`, `res.send()`, and `res.setHeader()`. If a handler uses a Vercel API not in the wrapper, it will fail only in dev (not production).

7. **Contact enrichment architecture** — Enrichment logic lives in `api/_lib/enrichment.ts` (shared by both the web API and Telegram bot). The web API routes through `api/profile/index.ts?action=enrich` to avoid consuming a Vercel function slot. The Telegram bot flow is in `api/telegram/_flows/enrichment.ts`. Both call the same `performEnrichment()` pipeline. Enrichment data is stored as JSONB in `contact_enrichments` table. Usage is tracked in `enrichment_usage` (per-user, per-month). The client-side store is `src/hooks/useEnrichment.ts` (Zustand). After saving a new contact via `/newcontact`, the bot stores the contact's ID in bot state (`_lastContactId`). If the user immediately taps `/enrich`, it auto-enriches that contact without showing the picker. The stored ID is cleared after use so subsequent `/enrich` calls show the normal picker.

8. **Telegram contact picker state** — The `/newcontact` flow has a `pick_contact_method` state between itinerary/event selection and field input. `handleUsersShared()` processes the `users_shared` update; `handleContactTextInput()` catches text in this state (the "Enter manually" button) and transitions to the normal field flow. The webhook routes `msg.users_shared` before forwarded-message checks.

9. **Clipboard in Telegram WebView** — `navigator.clipboard.writeText()` silently fails in Telegram's WebView. Always use the `copyToClipboard()` helper (try Clipboard API, then fallback to `textarea + document.execCommand('copy')`). Pattern is in `FollowUpDialog.tsx` and `WalletButton.tsx`. Return early if copy fails — do not open a DM link with stale clipboard content.

10. **Follow-Up dialog was renamed** — `InviteDialog.tsx` was renamed to `FollowUpDialog.tsx`. The button in `ContactsPage.tsx` says "Follow-Up" (not "Invite"). Internal state variables use `showFollowUp` / `setShowFollowUp`.

11. **Telegram callback prefix collisions** — Callback prefixes must be globally unique across all flows. Notably, `cf:` is used by contact confirmation (`cf:yes`/`cf:no` in `/newcontact`). The contacts date-filter uses `cd:` to avoid collision. Before adding a new callback prefix, grep for `data.startsWith('` in `webhook.ts` to check for conflicts. Current prefixes: `it:`, `ev:`, `cf:` (contact confirm), `ed:`, `yc:`, `ye:`, `xi:`, `xl:`, `xd:`, `xt:`, `xc:`, `xe:`, `iv:`, `tg:`, `fw:`, `fn:`, `hs:`, `cl:`, `ce:`, `cd:` (contacts date-filter), `cv:`, `cx:`, `en:`, `sb:` (subscribe).

12. **Contacts date filter + pagination** — The `/contacts` → "All Contacts" flow shows a date filter menu (Today, Last 3 Days, Last Week, Last Month, All Time) before listing contacts. Results are paginated at 10 per page with a "More ›" button. Callbacks use `cd:` prefix (`cd:today`, `cd:3d:10` for pagination). The `showContactsList()` function accepts optional `dateFilter`, `offset`, and `filterKey` params. Itinerary/event-scoped views bypass the date filter and show contacts directly.

13. **Telegram handle storage and lookup** — Handles are stored WITH the `@` prefix (e.g., `@johndoe`). When querying by handle, always use `.or(\`telegram_handle.ilike.@${handle},telegram_handle.ilike.${handle}\`)` to match both formats. The correct pattern is in `forward.ts`; `enrichment.ts` and `handshake.ts` also use this pattern.

14. **Subscription & tier-aware limits** — Tier detection lives in `api/_lib/subscription.ts` (`getUserTier()`, `getTierLimits()`). The `subscriptions` table is extended for multi-provider support (Stripe, Solana, Telegram Stars, Admin) via `sql/extend-subscriptions-multi-provider.sql`. Client-side limits are read from `useSubscription.getState().limits` (Zustand store at `src/hooks/useSubscription.ts`). Server-side enrichment limits use `getUserTier()` + `getTierLimits()`. `-1` means unlimited in the limits config. Admin grants use `payment_provider: 'admin'` with `current_period_end: null` for perpetual access. Solana/Stars payments have `current_period_end` set to 30/365 days from activation. The `get_user_tier()` SQL function also checks period expiry.

15. **Stripe webhook authentication** — The `?action=stripe-webhook` endpoint in `api/profile/index.ts` does NOT use JWT auth — it verifies Stripe's webhook signature via `stripe.webhooks.constructEvent()`. It must be routed before the `requireAuth()` check. The webhook handles `checkout.session.completed`, `customer.subscription.updated/deleted`, and `invoice.payment_failed`.

16. **Telegram Stars payment flow** — `/subscribe` command shows pricing with inline keyboard. User taps Monthly/Annual → `createInvoiceLink` generates a Telegram Stars payment link. The webhook handles `pre_checkout_query` (validation) and `successful_payment` (activation) update types before the `update.message` routing. Payment handler is in `api/telegram/_flows/subscribe.ts`.

17. **UpgradeModal is a named export** — Import as `import { UpgradeModal } from './UpgradeModal'`, not default import. Used in both `ProfilePage.tsx` and `ContactsPage.tsx`.

## Testing Checklist

Before deploying, verify:
- [ ] `npx tsc -b --noEmit` passes
- [ ] Telegram `/start` with link code works (account linking)
- [ ] X OAuth flow completes and redirects to `/profile?x_verified=true`
- [ ] Dashboard trust score shows correct profile photo / social signals
- [ ] Handshake initiate → claim → confirm-tx → mint flow works end-to-end
- [ ] Wallet connect + verify in Phantom browser works
- [ ] Contact enrichment: sparkle button triggers enrichment, inline panel displays results
- [ ] Contact enrichment: usage counter updates, limit enforced at 10/month
- [ ] Telegram `/enrich` command returns formatted profile with regenerate button
- [ ] Telegram `/enrich @handle` finds contact by telegram handle and enriches
- [ ] Telegram `/newcontact` → save → message suggests `/enrich` → tapping auto-enriches last contact
- [ ] Telegram `/contacts` → "All Contacts" → date filter menu → paginated results (10 per page, "More ›")
- [ ] Telegram `/newcontact` → "Pick from Telegram" auto-fills handle + name, skips to company field
- [ ] Telegram `/newcontact` → "Enter manually" starts normal field-by-field flow
- [ ] Follow-Up: date filter presets (Today, This week, etc.) and custom range filter contacts correctly
- [ ] Follow-Up: "+ Custom" opens dedicated template screen with variable chips and live preview
- [ ] Follow-Up: "Copy Message & Open DM" copies actual message (not @convenubot) in Telegram Mini App
- [ ] Subscription: `GET ?action=subscription` returns correct tier + limits
- [ ] Subscription: Free user sees current limits (10 itineraries, 100 contacts, 10 enrichments/mo)
- [ ] Subscription: Hitting a limit shows upgrade modal with pricing
- [ ] Subscription: Stripe checkout creates session and redirects to Stripe
- [ ] Subscription: Stripe webhook activates premium after successful payment
- [ ] Subscription: Solana checkout returns correct SOL amount from CoinGecko price
- [ ] Subscription: Premium user gets 100 enrichments, unlimited contacts/itineraries
- [ ] Subscription: Enhanced AI toggle on enrichment panel uses Sonnet for premium users
- [ ] Subscription: Batch "Enrich All" enriches up to 10 unenriched contacts (premium only)
- [ ] Subscription: vCard export downloads .vcf file (premium only)
- [ ] Subscription: Admin can upgrade/downgrade users from AdminDashboard
- [ ] Subscription: Profile page shows subscription section with correct tier info
- [ ] Telegram `/subscribe` shows pricing with Stars payment options
- [ ] Telegram `/subscribe` → Monthly/Annual → payment link generated
- [ ] Telegram enrichment limit shows upgrade CTA for free users
