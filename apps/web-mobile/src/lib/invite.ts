/**
 * 邀请码的落袋与读取。
 *
 * 链接形如 https://站点/?invite=ABCD2345 ：用户可能先逛几页再注册，
 * 所以一进站就把码存下来，注册时带上；注册成功后清掉，避免影响下一次注册。
 */
const STORAGE_KEY = 'videox:invite';

export function captureInviteCode(): void {
  try {
    const code = new URLSearchParams(window.location.search).get('invite')?.trim().toUpperCase();
    if (code && /^[A-Z0-9]{4,16}$/.test(code)) localStorage.setItem(STORAGE_KEY, code);
  } catch {
    /* 无痕模式忽略 */
  }
}

export function getInviteCode(): string | undefined {
  try {
    const code = localStorage.getItem(STORAGE_KEY)?.trim();
    return code || undefined;
  } catch {
    return undefined;
  }
}

export function clearInviteCode(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
