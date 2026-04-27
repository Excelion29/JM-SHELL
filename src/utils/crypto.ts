import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LEN = 32;
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;

function deriveKey(pin: string, salt: Buffer): Buffer {
  return crypto.scryptSync(pin, salt, KEY_LEN);
}

export function encrypt(plaintext: string, pin: string): string {
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const key = deriveKey(pin, salt);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: salt(16) + iv(12) + tag(16) + ciphertext — all base64
  return Buffer.concat([salt, iv, tag, encrypted]).toString('base64');
}

export function decrypt(ciphertext: string, pin: string): string {
  const buf = Buffer.from(ciphertext, 'base64');
  const salt = buf.subarray(0, SALT_LEN);
  const iv = buf.subarray(SALT_LEN, SALT_LEN + IV_LEN);
  const tag = buf.subarray(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + TAG_LEN);
  const encrypted = buf.subarray(SALT_LEN + IV_LEN + TAG_LEN);
  const key = deriveKey(pin, salt);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  try {
    return decipher.update(encrypted) + decipher.final('utf8');
  } catch {
    throw new Error('PIN incorrecto. Acceso denegado.');
  }
}
