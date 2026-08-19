import { describe, expect, it } from 'vitest';
import { registerSchema } from '../packages/shared/src/schemas.ts';
import { normalizeRegisterEmail, resolveDisplayName } from '../apps/api/src/modules/auth/register-input.ts';

describe('注册：用户名+密码即可，邮箱非必填', () => {
  it('只给用户名和密码可以通过', () => {
    const parsed = registerSchema.parse({ username: 'alice_01', password: 'Passw0rd' });
    expect(parsed.username).toBe('alice_01');
    expect(parsed.email).toBeUndefined();
    expect(parsed.displayName).toBeUndefined();
  });

  it('空邮箱或空白邮箱视为未填', () => {
    expect(registerSchema.parse({ username: 'alice_01', password: 'Passw0rd', email: '' }).email).toBeUndefined();
    expect(registerSchema.parse({ username: 'alice_01', password: 'Passw0rd', email: '   ' }).email).toBeUndefined();
  });

  it('填了非法邮箱仍然拒绝', () => {
    const r = registerSchema.safeParse({ username: 'alice_01', password: 'Passw0rd', email: 'not-an-email' });
    expect(r.success).toBe(false);
  });

  it('滑块验证码字段被丢掉，不当成邮箱校验', () => {
    const parsed = registerSchema.parse({
      username: 'alice_01',
      password: 'Passw0rd',
      captchaToken: 'slider-ok',
      verifyToken: 'x',
    });
    expect(parsed).toEqual({ username: 'alice_01', password: 'Passw0rd' });
    expect('captchaToken' in parsed).toBe(false);
  });

  it('可选邮箱会规范化；无邮箱写入 null', () => {
    expect(normalizeRegisterEmail(undefined)).toEqual({ email: null, emailNormalized: null });
    expect(normalizeRegisterEmail('')).toEqual({ email: null, emailNormalized: null });
    expect(normalizeRegisterEmail('  Ada@VideoX.local ')).toEqual({
      email: 'Ada@VideoX.local',
      emailNormalized: 'ada@videox.local',
    });
  });

  it('没有单独昵称时 displayName 等于用户名', () => {
    expect(resolveDisplayName('alice_01')).toBe('alice_01');
    expect(resolveDisplayName('alice_01', '  ')).toBe('alice_01');
    expect(resolveDisplayName('alice_01', 'Ada')).toBe('Ada');
  });
});
