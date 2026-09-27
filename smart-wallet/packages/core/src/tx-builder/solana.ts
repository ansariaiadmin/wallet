import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { isSolanaAddress } from '@chains/address';
import type { ChainConnector, FeeEstimate } from '@chains';
import {
  BuilderError,
  connectorOf,
  requireAmount,
  requireDecimals,
  resolveNetwork,
  unestimatedFee,
  type BuildTxOptions,
  type SolanaTxParams,
  type UnsignedTx,
} from './types';

/** Classic SPL Token program (not exported by web3.js 1.99). */
const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

/** Associated Token Account program. */
const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

/** Placeholder blockhash (32 zero bytes) used when none is supplied. */
const PLACEHOLDER_BLOCKHASH = '11111111111111111111111111111111';

/** `TransferChecked` instruction discriminator in the SPL Token program. */
const TRANSFER_CHECKED = 12;

/** Largest value a `u64` lamport/amount field can hold. */
const MAX_U64 = 18_446_744_073_709_551_615n;

/**
 * Builds an unsigned Solana transaction.
 *
 * Native transfers use `SystemProgram.transfer`; token transfers use a
 * hand-built `TransferChecked` instruction (web3.js 1.99 ships no SPL helpers)
 * with associated token accounts derived from the owner when `ownerAta` is not
 * given. The transaction is serialized without signatures.
 */
export async function buildSolanaTx(
  params: SolanaTxParams,
  options: BuildTxOptions = {},
): Promise<UnsignedTx> {
  const warnings: string[] = [];
  const fromKey = requireSolanaAddress(params.from, 'from');
  const toKey = requireSolanaAddress(params.to, 'to');
  const from = fromKey.toBase58();
  const to = toKey.toBase58();
  const amount = requireAmount(params.amount);
  if (amount > MAX_U64) {
    throw new BuilderError(`amount ${amount} exceeds the u64 range`);
  }

  const network = resolveNetwork(params.network);
  const connector = connectorOf(params, options);
  const { blockhash, lastValidBlockHeight, warning } = await resolveBlockhash(options);
  if (warning !== undefined) warnings.push(warning);

  const fee =
    connector === undefined
      ? unestimatedFee('solana', params.chainId, network)
      : await priceWithConnector(connector, {
          from,
          to,
          amount,
          token: params.token?.mint,
        });
  if (connector === undefined) {
    warnings.push('no connector supplied: fee fields are zero, estimate the fee before signing');
  }

  const transaction = new Transaction({ feePayer: fromKey, blockhash, lastValidBlockHeight });
  let programId = SystemProgram.programId.toBase58();
  let source: string | undefined;
  let destination: string | undefined;
  let mint: string | undefined;
  let decimals: number | undefined;

  if (params.token === undefined) {
    transaction.add(
      SystemProgram.transfer({ fromPubkey: fromKey, toPubkey: toKey, lamports: amount }),
    );
  } else {
    mint = requireSolanaAddress(params.token.mint, 'token.mint').toBase58();
    decimals = requireDecimals(params.token.decimals);
    const mintKey = new PublicKey(mint);

    source =
      params.token.ownerAta === undefined
        ? deriveAta(fromKey, mintKey).toBase58()
        : requireSolanaAddress(params.token.ownerAta, 'token.ownerAta').toBase58();
    destination = deriveAta(toKey, mintKey).toBase58();

    transaction.add(
      transferCheckedInstruction({
        source,
        destination,
        mint,
        owner: from,
        amount,
        decimals,
      }),
    );
    programId = SPL_TOKEN_PROGRAM_ID;
  }

  return {
    family: 'solana',
    chainId: params.chainId,
    network,
    serialized: transaction.serialize({ requireAllSignatures: false }),
    fee,
    meta: {
      recentBlockhash: blockhash,
      lastValidBlockHeight: lastValidBlockHeight.toString(),
      instructions: transaction.instructions.length.toString(),
      programId,
      from,
      to,
      amount: amount.toString(),
      mint: mint ?? null,
      decimals: decimals ?? null,
      sourceAta: source ?? null,
      destinationAta: destination ?? null,
      ataDerived: params.token !== undefined && params.token.ownerAta === undefined,
      feeEstimated: connector !== undefined,
      warnings,
    },
  };
}

/** Validates a base58 Solana address and returns it as a `PublicKey`. */
export function requireSolanaAddress(address: string, field: string): PublicKey {
  if (!isSolanaAddress(address)) {
    throw new BuilderError(`invalid Solana address for ${field}: ${address}`);
  }
  return new PublicKey(address);
}

/** Derives the associated token account of `owner` for `mint`. */
export function deriveAta(owner: PublicKey, mint: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), SPL_TOKEN_PROGRAM_ID_PUBKEY.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID_PUBKEY,
  );
  return ata;
}

const SPL_TOKEN_PROGRAM_ID_PUBKEY = new PublicKey(SPL_TOKEN_PROGRAM_ID);
const ASSOCIATED_TOKEN_PROGRAM_ID_PUBKEY = new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID);

/**
 * Builds an SPL `TransferChecked` instruction: the program rejects transfers
 * whose mint decimals do not match, so the decimals are part of the payload.
 */
export function transferCheckedInstruction(request: {
  readonly source: string;
  readonly destination: string;
  readonly mint: string;
  readonly owner: string;
  readonly amount: bigint;
  readonly decimals: number;
}): TransactionInstruction {
  const amountBytes = Buffer.alloc(8);
  amountBytes.writeBigUInt64LE(request.amount);

  return new TransactionInstruction({
    programId: SPL_TOKEN_PROGRAM_ID_PUBKEY,
    keys: [
      { pubkey: new PublicKey(request.source), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(request.mint), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(request.destination), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(request.owner), isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([
      Buffer.from([TRANSFER_CHECKED]),
      amountBytes,
      Buffer.from([request.decimals]),
    ]),
  });
}

/** Resolves the blockhash to build against, warning about placeholders. */
async function resolveBlockhash(options: BuildTxOptions): Promise<{
  readonly blockhash: string;
  readonly lastValidBlockHeight: number;
  readonly warning?: string;
}> {
  if (options.recentBlockhash !== undefined) {
    if (options.lastValidBlockHeight === undefined) {
      return {
        blockhash: options.recentBlockhash,
        lastValidBlockHeight: Number.MAX_SAFE_INTEGER,
        warning:
          'lastValidBlockHeight not supplied: the blockhash is treated as non-expiring, set it before signing',
      };
    }
    return {
      blockhash: options.recentBlockhash,
      lastValidBlockHeight: options.lastValidBlockHeight,
    };
  }

  if (options.blockhashProvider !== undefined) {
    const latest = await options.blockhashProvider();
    return {
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight ?? Number.MAX_SAFE_INTEGER,
    };
  }

  return {
    blockhash: PLACEHOLDER_BLOCKHASH,
    lastValidBlockHeight: 0,
    warning:
      'recent blockhash not supplied: built with a placeholder, fetch a real one before signing',
  };
}

/** Prices the transaction through a P3 connector. */
async function priceWithConnector(
  connector: ChainConnector,
  request: { from: string; to: string; amount: bigint; token?: string },
): Promise<FeeEstimate> {
  try {
    return await connector.estimateFee({
      from: request.from,
      to: request.to,
      amount: request.amount,
      token: request.token,
    });
  } catch (error) {
    throw new BuilderError(
      `fee estimation failed on ${connector.chainId}: ${(error as Error).message}`,
    );
  }
}
