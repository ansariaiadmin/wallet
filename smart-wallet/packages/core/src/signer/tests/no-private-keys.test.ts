import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The signer reads a key copy and must never expose it. This scans the signer
 * sources for the patterns that would leak one: key literals, logging, file or
 * keystore access, and anything that would broadcast instead of sign.
 */
describe('signer never leaks key material', () => {
  const sourceDir = path.join(process.cwd(), 'src', 'signer');

  /** Top level signer sources only: the tests directory is excluded. */
  const sources = fs
    .readdirSync(sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => path.join(sourceDir, entry.name));

  it('has sources to scan', () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  it('contains no hardcoded key literals', () => {
    for (const file of sources) {
      for (const line of lines(file)) {
        // A 32-byte hex literal would be a hardcoded secret.
        expect(line).not.toMatch(/0x[0-9a-fA-F]{64}/);
        // No key word inside a string or template literal.
        expect(line).not.toMatch(/["'`][^"'`]*privateKey[^"'`]*["'`]/);
        expect(line).not.toMatch(/["'`][^"'`]*private_key[^"'`]*["'`]/);
        expect(line).not.toMatch(/mnemonic|seedPhrase|seed_phrase/);
      }
    }
  });

  it('never logs, reads files or touches the keystore', () => {
    for (const file of sources) {
      for (const line of lines(file)) {
        expect(line).not.toMatch(/console\./);
        expect(line).not.toMatch(/from '(node:)?fs'/);
        expect(line).not.toMatch(/keystore/);
        expect(line).not.toMatch(/localStorage|sessionStorage/);
      }
    }
  });

  it('only signs: no broadcasting or external signing imports', () => {
    for (const file of sources) {
      for (const line of lines(file)) {
        expect(line).not.toMatch(/signAndSend/);
        expect(line).not.toMatch(/sendRawTransaction|broadcast/);
        expect(line).not.toMatch(/from 'ethers/);
      }
    }
  });

  it('zeroes the key buffer in every family signer', () => {
    for (const name of ['evm.ts', 'solana.ts', 'tron.ts', 'index.ts']) {
      const source = fs.readFileSync(path.join(sourceDir, name), 'utf8');

      expect(source).toMatch(/try \{/);
      expect(source).toMatch(/finally \{/);
      expect(source).toMatch(/zeroIfBuffer\(/);
    }
  });
});

/** Reads a source file as lines, so scans never match across statements. */
function lines(file: string): string[] {
  return fs.readFileSync(file, 'utf8').split('\n');
}
