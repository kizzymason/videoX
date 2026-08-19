/** 注册入参规范化：邮箱可空，昵称默认等于用户名。无验证码逻辑。 */

export function normalizeRegisterEmail(email?: string | null): {
  email: string | null;
  emailNormalized: string | null;
} {
  const trimmed = email?.trim() ?? '';
  if (!trimmed) return { email: null, emailNormalized: null };
  return { email: trimmed, emailNormalized: trimmed.toLowerCase() };
}

export function resolveDisplayName(username: string, displayName?: string | null): string {
  const nick = displayName?.trim();
  return nick || username.trim();
}
