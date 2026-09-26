import { describe, expect, it } from 'vitest';
import { createConnector, createConnectors, resolveRpcUrls } from '@chains/registry';
import { CHAIN_IDS, CHAINS } from '@chains/chains';
import { UnsupportedChainError } from '@chains/errors';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('chain registry', () => {
  it('creates a connector for every supported chain', () => {
    const connectors = createConnectors(CHAIN_IDS, {
      rpcUrls: ['http://127.0.0.1:1'],
      retry: { attempts: 1, delayMs: 0 },
    });

    expect(Object.keys(connectors).sort()).toEqual([...CHAIN_IDS].sort());
    for (const chainId of CHAIN_IDS) {
      const connector = connectors[chainId];
      expect(connector?.chainId).toBe(chainId);
      expect(connector?.network).toBe('mainnet');
    }
  });

  it('covers the required families', () => {
    expect(CHAIN_IDS.filter((id) => CHAINS[id].family === 'evm')).toEqual([
      'ethereum',
      'polygon',
      'base',
      'arbitrum',
      'optimism',
      'bsc',
    ]);
    expect(CHAIN_IDS.filter((id) => CHAINS[id].family === 'solana')).toEqual(['solana']);
    expect(CHAIN_IDS.filter((id) => CHAINS[id].family === 'tron')).toEqual(['tron']);
  });

  it('exposes at least one endpoint per chain and network', () => {
    for (const chainId of CHAIN_IDS) {
      expect(resolveRpcUrls(chainId).length).toBeGreaterThan(0);
      expect(resolveRpcUrls(chainId, { network: 'testnet' }).length).toBeGreaterThan(0);
    }
  });

  it('prefers caller-supplied endpoints', () => {
    expect(resolveRpcUrls('ethereum', { rpcUrls: ['http://localhost:9999'] })).toEqual([
      'http://localhost:9999',
    ]);
  });

  it('switches to testnet endpoints for testnet connectors', () => {
    const connector = createConnector('polygon', {
      network: 'testnet',
      rpcUrls: ['http://127.0.0.1:1'],
    });

    expect(connector.network).toBe('testnet');
    expect(connector.chainId).toBe('polygon');
  });

  it('rejects unknown chains', () => {
    expect(() => createConnector('dogecoin' as never)).toThrow(UnsupportedChainError);
  });

  it('never handles private keys', () => {
    const sourceDir = path.join(process.cwd(), 'src');
    const sources = listFiles(sourceDir).filter((file) => file.endsWith('.ts'));

    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      const source = fs.readFileSync(file, 'utf8');
      expect(source).not.toMatch(/privateKey|private_key|mnemonic|seedPhrase/);
      expect(source).not.toMatch(/from '(node:)?fs'/);
      expect(source).not.toMatch(/console\./);
      expect(source).not.toMatch(/@wallet\/core\/keystore|keystore/);
    }
  });
});

function listFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}
