import { describe, expect, it } from 'vitest';
import { canReuseInstantAssets } from '../apps/api/src/modules/uploads/access-level.ts';

describe('秒传不得跨 accessLevel', () => {
  it('同档可秒：免费明文、会员加密', () => {
    expect(canReuseInstantAssets({ accessLevel: 'free', isEncrypted: false }, 'free')).toBe(true);
    expect(canReuseInstantAssets({ accessLevel: 'login', isEncrypted: false }, 'login')).toBe(true);
    expect(canReuseInstantAssets({ accessLevel: 'vip', isEncrypted: true }, 'vip')).toBe(true);
  });

  it('免费片不能秒成会员明文', () => {
    expect(canReuseInstantAssets({ accessLevel: 'free', isEncrypted: false }, 'vip')).toBe(false);
    expect(canReuseInstantAssets({ accessLevel: 'login', isEncrypted: false }, 'vip')).toBe(false);
  });

  it('会员加密片不能秒成免费可播', () => {
    expect(canReuseInstantAssets({ accessLevel: 'vip', isEncrypted: true }, 'free')).toBe(false);
    expect(canReuseInstantAssets({ accessLevel: 'vip', isEncrypted: true }, 'login')).toBe(false);
  });

  it('免费和登录也不互秒', () => {
    expect(canReuseInstantAssets({ accessLevel: 'free', isEncrypted: false }, 'login')).toBe(false);
    expect(canReuseInstantAssets({ accessLevel: 'login', isEncrypted: false }, 'free')).toBe(false);
  });

  it('档位一致但加密形态对不上也不秒', () => {
    expect(canReuseInstantAssets({ accessLevel: 'vip', isEncrypted: false }, 'vip')).toBe(false);
    expect(canReuseInstantAssets({ accessLevel: 'free', isEncrypted: true }, 'free')).toBe(false);
  });
});
