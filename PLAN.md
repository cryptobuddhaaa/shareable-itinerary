# Proof of Handshake — Implementation Plan

## Overview

Add Web3 features to the existing itinerary/contacts app, centered around "Proof of Handshake" — a system where users can cryptographically prove they met someone at an event and earn points for building their network.

**Chain:** Solana (devnet first, mainnet later)
**Wallets:** Phantom + Solflare
**NFT standard:** Metaplex Bubblegum V2 compressed NFTs (soulbound)

---

## Phase 1: Wallet Integration + Database Schema

### 1A. Install Solana dependencies

```
npm install @solana/web3.js @solana/wallet-adapter-base @solana/wallet-adapter-react \
  @solana/wallet-adapter-react-ui @solana/wallet-adapter-phantom @solana/wallet-adapter-solflare \
  @metaplex-foundation/umi @metaplex-foundation/umi-bundle-defaults \
  @metaplex-foundation/mpl-bubblegum bs58
```

### 1B. Wallet connection UI (web app)

**New files:**
- `src/contexts/WalletContext.tsx` — Solana `ConnectionProvider` + `WalletProvider` wrapping the app
- `src/components/WalletButton.tsx` — connect/disconnect button using `@solana/wallet-adapter-react-ui`

**Modified files:**
- `src/main.tsx` — wrap app in `WalletContext`
- `src/components/Login.tsx` or header area — add `WalletButton`

**Behavior:**
- User connects Phantom or Solflare via standard wallet adapter modal
- Connected wallet public key stored in Supabase `user_wallets` table, linked to their auth user ID
- Users can connect wallet without it being mandatory — Web2 features still work without a wallet

### 1C. New database tables

**`user_wallets`** — Links Supabase auth users to Solana wallets
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| user_id | UUID FK | References auth.users |
| wallet_address | TEXT | Solana public key (base58) |
| is_primary | BOOLEAN | Default true |
| verified_at | TIMESTAMPTZ | When ownership was verified via signature |
| created_at | TIMESTAMPTZ | |

UNIQUE(user_id, wallet_address)

**`handshakes`** — Tracks handshake state between two users
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| initiator_user_id | UUID | User who started the handshake |
| receiver_user_id | UUID | NULL until receiver claims |
| receiver_identifier | TEXT | Telegram handle or email used for invite |
| contact_id | UUID FK | The contact record this handshake is for |
| event_id | TEXT | The itinerary event ID where they met |
| event_title | TEXT | Denormalized |
| event_date | DATE | When the meeting occurred |
| initiator_minted_at | TIMESTAMPTZ | When initiator minted their side |
| receiver_minted_at | TIMESTAMPTZ | When receiver minted their side |
| status | TEXT | 'pending' / 'matched' / 'minted' / 'expired' |
| initiator_nft_address | TEXT | cNFT asset ID on Solana |
| receiver_nft_address | TEXT | cNFT asset ID on Solana |
| points_awarded | INTEGER | Points given to each party |
| created_at | TIMESTAMPTZ | |
| expires_at | TIMESTAMPTZ | e.g., 30 days after creation |

**`user_points`** — Points ledger
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| user_id | UUID FK | |
| handshake_id | UUID FK | |
| points | INTEGER | Points earned |
| reason | TEXT | 'handshake_complete', 'bonus_premium', etc. |
| created_at | TIMESTAMPTZ | |

**`trust_scores`** — Anti-sybil trust data
| Column | Type | Notes |
|--------|------|-------|
| user_id | UUID PK | |
| telegram_premium | BOOLEAN | |
| has_profile_photo | BOOLEAN | |
| telegram_account_age_days | INTEGER | Estimated from user ID |
| total_handshakes | INTEGER | |
| trust_level | INTEGER | 1-5 computed score |
| updated_at | TIMESTAMPTZ | |

### 1D. Wallet ownership verification

**New API endpoint:** `api/wallet/verify.ts`
- User signs a message: `"Link wallet to Shareable Itinerary: {user_id} at {timestamp}"`
- Server verifies the signature against the claimed public key using `@solana/web3.js`
- Stores verified wallet in `user_wallets`

---

## Phase 2: Trust Score + Anti-Sybil System

### 2A. Trust score computation

**New file:** `src/services/trustService.ts`

**New API endpoint:** `api/trust/compute.ts`
- Called after wallet link, after Telegram link, periodically
- Computes trust_level (1-5) based on:
  - Telegram Premium: +2
  - Has profile photo: +0.5
  - Has username: +0.5
  - Telegram account age > 1 year: +1
  - Connected wallet: +0.5
  - Existing verified handshakes > 3: +0.5

### 2B. Telegram bot enrichment

**Modified file:** `api/telegram/webhook.ts`
- On `/link` command (already exists), also store `is_premium`, profile photo count, and user ID (for age estimation) into `trust_scores`
- On `/start` or any message, update trust data if stale

---

## Phase 3: Proof of Handshake Flow

### 3A. Initiate handshake (from contact card)

**New component:** `src/components/HandshakeButton.tsx`
- Appears on each contact card in `ContactsList.tsx`
- Shows handshake status: "Mint Handshake" / "Pending" / "Completed"
- Requires connected wallet

**Modified file:** `src/components/ContactsList.tsx`
- Add `HandshakeButton` per contact row

**Flow:**
1. User clicks "Mint Handshake" on a contact
2. Frontend checks user has a verified wallet
3. Creates `handshakes` row with status='pending', receiver_identifier = contact's telegram_handle or email
4. User signs a Solana transaction (or message) confirming intent — this is the "initiator mint"
5. Invite link generated and displayed — user can share via Telegram or copy link

### 3B. Claim handshake (receiver side)

**New API endpoint:** `api/handshake/claim.ts`
- Receiver arrives via invite link
- Looks up pending handshake by receiver_identifier
- Receiver must: sign up, connect wallet, and sign their side
- On both sides minted → status = 'matched', trigger NFT mint

### 3C. Server-side NFT minting

**New API endpoint:** `api/handshake/mint.ts`
- Called when both sides have confirmed
- Uses Metaplex Bubblegum V2 to mint two soulbound cNFTs:
  - One to initiator's wallet
  - One to receiver's wallet
- NFT metadata includes: both names, event title, date, location, handshake ID
- Tree authority keypair stored as env var (`HANDSHAKE_TREE_KEYPAIR`)
- Updates handshake row with NFT asset IDs and status='minted'
- Awards points to both users

**New env vars:**
- `SOLANA_RPC_URL` — Helius or QuickNode (needed for DAS API)
- `HANDSHAKE_TREE_KEYPAIR` — Merkle tree authority (base58 secret key)

### 3D. Points calculation

Points per handshake depend on trust levels:
- Base: 10 points each
- Both Telegram Premium: +5 bonus each
- Same event date (verifiable from itinerary data): +5 bonus
- Receiver has trust_level >= 3: +3 bonus to initiator (and vice versa)
- Diminishing returns: 2nd handshake with same person = 2 points, 3rd+ = 0

---

## Phase 4: UI — Handshake Dashboard

### 4A. Points & handshake overview

**New component:** `src/components/HandshakeDashboard.tsx`
- Shows total points, handshake count, trust level
- Lists all handshakes with status
- Filterable by: pending / completed / expired

**New component:** `src/components/HandshakeCard.tsx`
- Individual handshake display: event name, date, counterparty, status, NFT link

### 4B. Profile / wallet section

**New component:** `src/components/ProfilePage.tsx`
- Connected wallet display
- Trust level visualization
- Points history
- Collection of minted handshake NFTs (fetched via DAS API)

### 4C. Routing

**Modified file:** `src/App.tsx`
- Add routes for `/profile` and `/handshakes`
- Add nav items

---

## Phase 5: Telegram Bot Integration

### 5A. Handshake commands

**Modified file:** `api/telegram/webhook.ts`

New commands:
- `/handshakes` — List pending and completed handshakes
- `/points` — Show current points balance

When a user adds a contact via the bot and includes a telegram handle:
- Auto-suggest: "Want to mint a Proof of Handshake with @handle?"
- If yes, create pending handshake and DM the contact (if they're a bot user)

### 5B. Telegram Mini App wallet connect

This is Phase 5 because it's harder than web wallet connect. Requires Phantom deeplinks with an intermediate redirect page. We can defer this and still have a working product — users mint via the web app.

---

## Implementation Order

| Step | What | Est. Complexity |
|------|------|----------------|
| **1** | Database migrations (tables + RLS) | Low |
| **2** | Wallet connect on web app | Medium |
| **3** | Wallet verification endpoint | Medium |
| **4** | Trust score system | Low |
| **5** | Handshake initiation flow (UI + API) | High |
| **6** | Handshake claim flow | High |
| **7** | Server-side cNFT minting | High |
| **8** | Points system | Medium |
| **9** | Dashboard UI | Medium |
| **10** | Telegram bot commands | Medium |
| **11** | Telegram Mini App wallet (deferred) | High |

Steps 1-4 can be built and shipped as a "wallet connected" milestone.
Steps 5-8 are the core handshake loop.
Steps 9-10 are polish.
Step 11 is a separate effort.

---

## Key Decisions Needed

1. **Solana cluster**: Start on devnet, switch to mainnet-beta when ready?
2. **Merkle tree size**: How many handshakes to provision for? (tree depth 20 = ~1M leaves, costs ~1.5 SOL to create)
3. **NFT metadata hosting**: Arweave (permanent) vs. our own server (cheaper, less decentralized)?
4. **Invite mechanism**: Telegram DM from bot, share link, or both?
5. **Points-to-token ratio**: Define later, or set a preliminary ratio now?
