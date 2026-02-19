/**
 * Setup script: Creates a Bubblegum Merkle tree on Solana devnet for cNFT minting.
 *
 * Prerequisites:
 *   1. Fund the treasury wallet with devnet SOL (at least 1 SOL):
 *      Visit https://faucet.solana.com and paste your VITE_TREASURY_WALLET address.
 *
 *   2. Export your treasury wallet's SECRET KEY as an env var.
 *      Phantom: Settings > Security > Export Private Key → gives you a base58 string.
 *
 *      export TREE_AUTHORITY_SECRET_KEY="your_base58_private_key_here"
 *
 *      Or as a JSON byte array (64 bytes):
 *      export TREE_AUTHORITY_SECRET_KEY="[1,2,3,...,64 bytes]"
 *
 * Usage:
 *   npx tsx scripts/setup-merkle-tree.ts
 *
 * Output:
 *   Prints the env vars you need to set in Vercel:
 *     HANDSHAKE_TREE_KEYPAIR  (base58 secret key of the tree CREATOR — your treasury wallet)
 *     HANDSHAKE_MERKLE_TREE   (public key of the created Merkle tree)
 */

import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createTree, mplBubblegum } from '@metaplex-foundation/mpl-bubblegum';
import {
  generateSigner,
  createSignerFromKeypair,
} from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';

const SOLANA_RPC = process.env.VITE_SOLANA_RPC_URL || 'https://api.devnet.solana.com';

async function main() {
  const secretKeyEnv = process.env.TREE_AUTHORITY_SECRET_KEY;
  if (!secretKeyEnv) {
    console.error('ERROR: Set TREE_AUTHORITY_SECRET_KEY env var.');
    console.error('');
    console.error('  export TREE_AUTHORITY_SECRET_KEY="your_base58_private_key"');
    console.error('');
    console.error('Get this from Phantom: Settings > Security > Export Private Key');
    process.exit(1);
  }

  let secretKeyBytes: Uint8Array;
  try {
    // Try JSON byte array first
    const arr = JSON.parse(secretKeyEnv);
    secretKeyBytes = new Uint8Array(arr);
  } catch {
    // Try base58 decode (Phantom's export format)
    try {
      secretKeyBytes = base58.serialize(secretKeyEnv);
    } catch {
      console.error('ERROR: TREE_AUTHORITY_SECRET_KEY must be a base58 string or JSON byte array.');
      process.exit(1);
    }
  }

  console.log('Setting up Bubblegum Merkle tree on devnet...');
  console.log(`RPC: ${SOLANA_RPC}\n`);

  const umi = createUmi(SOLANA_RPC).use(mplBubblegum());

  const keypair = umi.eddsa.createKeypairFromSecretKey(secretKeyBytes);
  const authority = createSignerFromKeypair(umi, keypair);
  umi.identity = authority;
  umi.payer = authority;

  console.log(`Tree creator (treasury wallet): ${authority.publicKey}`);

  const balance = await umi.rpc.getBalance(authority.publicKey);
  const solBalance = Number(balance.basisPoints) / 1e9;
  console.log(`Balance: ${solBalance} SOL`);

  if (solBalance < 0.5) {
    console.error(`\nERROR: Need at least 0.5 SOL, have ${solBalance}.`);
    console.error('Fund at https://faucet.solana.com');
    process.exit(1);
  }

  const merkleTree = generateSigner(umi);

  console.log(`\nCreating Merkle tree: ${merkleTree.publicKey}`);
  console.log('Config: maxDepth=14, maxBufferSize=64 (supports ~16,384 cNFTs)');

  const tx = await createTree(umi, {
    merkleTree,
    maxDepth: 14,
    maxBufferSize: 64,
  }).sendAndConfirm(umi);

  const txSig = base58.deserialize(tx.signature)[0];
  console.log(`\nTree created! Tx: ${txSig}`);

  // The tree creator's secret key in base58 — needed for minting
  const authorityBase58 = base58.deserialize(secretKeyBytes)[0];

  console.log('\n' + '='.repeat(60));
  console.log('SET THESE ENV VARS IN VERCEL:');
  console.log('='.repeat(60));
  console.log(`\nHANDSHAKE_TREE_KEYPAIR=${authorityBase58}`);
  console.log(`HANDSHAKE_MERKLE_TREE=${merkleTree.publicKey}`);
  console.log('\n' + '='.repeat(60));
  console.log('\nHANDSHAKE_TREE_KEYPAIR = your treasury wallet secret key (the tree creator)');
  console.log('HANDSHAKE_MERKLE_TREE  = the Merkle tree address on Solana');
  console.log('\nThe treasury wallet must stay funded to pay for minting (~0.00001 SOL per mint).');
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
