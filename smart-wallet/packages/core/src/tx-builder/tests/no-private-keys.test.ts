import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The builder must never handle secrets: it receives plain transfer
 * parameters and returns an unsigned transaction. Signing (and therefore key
 * material) belongs to a later phase.
 */
describe('tx-builder never handles private keys', () => {
  const sourceDir = path.join(process.cwd(), 'src', 'tx-builder');

  /** Top level builder sources only: the tests directory is excluded. */
  const sources = fs
    .readdirSync(sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => path.join(sourceDir, entry.name));

  it('has sources to scan', () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  it('contains no key material and no hidden I/O', () => {
    for (const file of sources) {
      const source = fs.readFileSync(file, 'utf8');

      expect(source).not.toMatch(/privateKey|private_key|mnemonic|seedPhrase|secretKey/);
      expect(source).not.toMatch(/from '(node:)?fs'/);
      expect(source).not.toMatch(/console\./);
      expect(source).not.toMatch(/@wallet\/core\/keystore|keystore/);
    }
  });

  it('never signs: no signature helpers are imported', () => {
    for (const file of sources) {
      const source = fs.readFileSync(file, 'utf8');

      expect(source).not.toMatch(/signTransaction|signRawTransaction|signAndSend/);
    }
  });
});
