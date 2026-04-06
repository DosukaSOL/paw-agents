// ─── Secure Key Storage ───
// Keys encrypted at rest, never exposed to LLM or logs.

import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;
const ITERATIONS = 100_000;

export interface EncryptedPayload {
  iv: string;
  salt: string;
  tag: string;
  ciphertext: string;
}

function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, 'sha512');
}

export function encryptKey(secretKey: Uint8Array, password: string): EncryptedPayload {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(password, salt);
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(secretKey)),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    iv: iv.toString('hex'),
    salt: salt.toString('hex'),
    tag: tag.toString('hex'),
    ciphertext: encrypted.toString('hex'),
  };
}

export function decryptKey(payload: EncryptedPayload, password: string): Uint8Array {
  const salt = Buffer.from(payload.salt, 'hex');
  const key = deriveKey(password, salt);
  const iv = Buffer.from(payload.iv, 'hex');
  const tag = Buffer.from(payload.tag, 'hex');
  const ciphertext = Buffer.from(payload.ciphertext, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return new Uint8Array(decrypted);
}

// Isolated signing module — signs data without exposing the key
export class SecureSigner {
  private encryptedPayload: EncryptedPayload | null = null;
  private password: string;

  constructor(password: string) {
    this.password = password;
  }

  importKey(secretKey: Uint8Array): void {
    this.encryptedPayload = encryptKey(secretKey, this.password);
    // Immediately zero out the input
    secretKey.fill(0);
  }

  async sign(message: Uint8Array): Promise<Uint8Array> {
    if (!this.encryptedPayload) {
      throw new Error('No key imported');
    }
    // Decrypt key only for signing, then discard
    const key = decryptKey(this.encryptedPayload, this.password);
    try {
      // Use tweetnacl for Ed25519 signing (Solana-compatible)
      const nacl = await import('tweetnacl');
      const signature = nacl.sign.detached(message, key);
      return signature;
    } finally {
      // Zero out decrypted key immediately
      key.fill(0);
    }
  }

  getPublicKey(): Uint8Array {
    if (!this.encryptedPayload) {
      throw new Error('No key imported');
    }
    const key = decryptKey(this.encryptedPayload, this.password);
    try {
      const publicKey = key.slice(32, 64);
      const result = new Uint8Array(publicKey);
      return result;
    } finally {
      key.fill(0);
    }
  }

  destroy(): void {
    this.encryptedPayload = null;
  }
}
