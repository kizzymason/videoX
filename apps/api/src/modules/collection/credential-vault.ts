import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../../config/env.js';

const key = createHash('sha256').update(env.ACCOUNT_CREDENTIALS_KEY, 'utf8').digest();

/** Encrypts a credential for storage. Format: base64(iv[12] + tag[16] + ciphertext). */
export function encryptCredential(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

export function decryptCredential(value: string): string {
  const raw = Buffer.from(value, 'base64');
  if (raw.length < 28) throw new Error('凭据密文格式无效');
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}
