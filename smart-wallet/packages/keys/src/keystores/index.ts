/**
 * Keystore backends.
 *
 * Both implementations speak the same {@link KeyStore} interface, so a caller
 * swaps persistence without touching its own code.
 */

export { FileKeyStore } from './file.js';
export { MemoryKeyStore, type KeyStore } from '../keystore.js';
