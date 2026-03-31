import { pbkdf2Sync, randomBytes, timingSafeEqual } from "crypto";

const HASH_PREFIX = "pbkdf2_sha256";
const HASH_ITERATIONS = 310000;
const KEY_LENGTH = 32;

function deriveKey(password: string, salt: string, iterations: number): Buffer {
  return pbkdf2Sync(password, salt, iterations, KEY_LENGTH, "sha256");
}

export function isPasswordHash(value: string): boolean {
  return value.startsWith(`${HASH_PREFIX}$`);
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const key = deriveKey(password, salt, HASH_ITERATIONS).toString("hex");
  return `${HASH_PREFIX}$${HASH_ITERATIONS}$${salt}$${key}`;
}

export function verifyPassword(password: string, storedValue: string): { valid: boolean; needsRehash: boolean } {
  if (!storedValue) return { valid: false, needsRehash: false };

  if (!isPasswordHash(storedValue)) {
    return { valid: storedValue === password, needsRehash: storedValue === password };
  }

  const [prefix, iterText, salt, storedHex] = storedValue.split("$");
  if (!prefix || !iterText || !salt || !storedHex) return { valid: false, needsRehash: false };

  const iterations = Number(iterText);
  if (!Number.isFinite(iterations) || iterations <= 0) return { valid: false, needsRehash: false };

  const expected = Buffer.from(storedHex, "hex");
  const derived = deriveKey(password, salt, iterations);
  if (expected.length !== derived.length) return { valid: false, needsRehash: false };

  const valid = timingSafeEqual(expected, derived);
  const needsRehash = valid && iterations < HASH_ITERATIONS;
  return { valid, needsRehash };
}
