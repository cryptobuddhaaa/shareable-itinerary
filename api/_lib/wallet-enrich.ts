/**
 * Fetches on-chain data for a Solana wallet: age, transaction count, token holdings.
 * Used by trust score computation to enrich wallet signals.
 */

import { Connection, PublicKey } from '@solana/web3.js';

const SOLANA_RPC = process.env.VITE_SOLANA_RPC_URL || 'https://api.devnet.solana.com';

/** SPL Token Program ID */
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQEcfiz4PoN1V4UfBbQN2tTKtbpLLCLxR8mQ');

export interface WalletEnrichment {
  walletAgeDays: number | null;
  walletTxCount: number;
  walletHasTokens: boolean;
}

/**
 * Enrich wallet data by querying Solana RPC.
 * Fetches up to 1000 transaction signatures (for count + age) and token holdings.
 * Returns fallback values on failure — errors are non-fatal.
 */
export async function enrichWalletData(walletAddress: string): Promise<WalletEnrichment> {
  const connection = new Connection(SOLANA_RPC, 'confirmed');
  const pubkey = new PublicKey(walletAddress);

  let walletAgeDays: number | null = null;
  let walletTxCount = 0;
  let walletHasTokens = false;

  try {
    // Fetch up to 1000 signatures (newest first).
    // Count = number returned (capped at 1000).
    // Age = blockTime of the oldest signature in the batch (lower bound on true age).
    const signatures = await connection.getSignaturesForAddress(pubkey, { limit: 1000 });

    walletTxCount = signatures.length;

    if (signatures.length > 0) {
      const oldest = signatures[signatures.length - 1];
      if (oldest.blockTime) {
        const ageMs = Date.now() - oldest.blockTime * 1000;
        walletAgeDays = Math.max(0, Math.floor(ageMs / (24 * 60 * 60 * 1000)));
      }
    }
  } catch (err) {
    console.error('Wallet enrichment — signatures error:', err);
  }

  try {
    // Check SPL token holdings (any account with non-zero balance)
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(pubkey, {
      programId: TOKEN_PROGRAM_ID,
    });

    walletHasTokens = tokenAccounts.value.some((account) => {
      const amount = account.account.data.parsed?.info?.tokenAmount?.uiAmount;
      return amount != null && amount > 0;
    });
  } catch (err) {
    console.error('Wallet enrichment — tokens error:', err);
  }

  return { walletAgeDays, walletTxCount, walletHasTokens };
}
