// PIN 哈希与校验：使用 scrypt 加盐哈希，验证时恒定时间比较。
// 设计目标：即使 JSON 文件泄露，也无法逆向出原始 PIN。

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SALT_LENGTH = 16;
const KEY_LENGTH = 64;
const SEPARATOR = ':';

export function hashPin(pin: string): string {
  const salt = randomBytes(SALT_LENGTH).toString('hex');
  const key = scryptSync(pin, salt, KEY_LENGTH);
  return `${salt}${SEPARATOR}${key.toString('hex')}`;
}

export function verifyPin(pin: string, hash: string): boolean {
  const [salt, storedKey] = hash.split(SEPARATOR);
  if (!salt || !storedKey) return false;
  try {
    const derived = scryptSync(pin, salt, KEY_LENGTH);
    return timingSafeEqual(derived, Buffer.from(storedKey, 'hex'));
  } catch {
    return false;
  }
}
