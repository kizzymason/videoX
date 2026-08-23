import { create } from 'zustand';
import type { CurrentUser } from '@videox/shared';
import { authApi, BASE_URL, setAccessToken, setUnauthorizedHandler } from '../lib/api';

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
        if (payload.data?.user.role === 'partner') {
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
    if (session.user.role !== 'partner') {
      setAccessToken(null);
      throw new Error('该账号没有合伙人后台权限');
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
