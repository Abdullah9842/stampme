import argon2 from "argon2";

const PIN_REGEX = /^\d{6}$/;

export function isValidPinFormat(pin: string): boolean {
  return PIN_REGEX.test(pin);
}

export async function hashPin(pin: string): Promise<string> {
  if (!isValidPinFormat(pin)) {
    throw new Error("PIN must be exactly 6 digits");
  }
  return argon2.hash(pin, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  if (!isValidPinFormat(pin)) return false;
  try {
    return await argon2.verify(hash, pin);
  } catch {
    return false;
  }
}
