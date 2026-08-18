import { create } from 'zustand';
import type { CurrentUser } from '@videox/shared';
import { BASE_URL, authApi, setAccessToken, setUnauthorizedHandler } from '../lib/api';

interface AuthState {
  user: CurrentUser | null;
  initializing: boolean;
  bootstrap: () => Promise<void>;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  initializing: true,

  bootstrap: async () => {
    try {
      const res = await fetch(`${BASE_URL}/auth/refresh`, { method: 'POST', credentials: 'include' });
      if (res.ok) {
        const payload = (await res.json()) as { data?: { accessToken: string; user: CurrentUser } };
        if (payload.data) {
          setAccessToken(payload.data.accessToken);
          set({ user: payload.data.user });
        }
      }
    } catch {
      /* 未登录 */
    } finally {
      set({ initializing: false });
    }
  },

  login: async (identifier, password) => {
    const session = await authApi.login({ identifier, password, remember: true });
    // 后台只放行 admin，非管理员即便密码正确也不给会话。
    if (session.user.role !== 'admin') {
      setAccessToken(null);
      throw new Error('该账号没有管理后台权限');
    }
    setAccessToken(session.accessToken);
    set({ user: session.user });
  },

  logout: async () => {
    try {
      await authApi.logout();
    } finally {
      setAccessToken(null);
      set({ user: null });
    }
  },
}));

setUnauthorizedHandler(() => {
  useAuthStore.setState({ user: null });
});
