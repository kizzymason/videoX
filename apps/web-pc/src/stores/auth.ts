import { create } from 'zustand';
import type { CurrentUser } from '@videox/shared';
import { authApi, setAccessToken, setUnauthorizedHandler } from '../lib/api';

interface AuthState {
  user: CurrentUser | null;
  /** 首次进站的 refresh 探测是否还在进行中，避免闪一下登录按钮 */
  initializing: boolean;
  bootstrap: () => Promise<void>;
  login: (identifier: string, password: string, remember?: boolean) => Promise<void>;
  register: (input: { username: string; password: string; email?: string; displayName?: string }) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: CurrentUser | null) => void;
  refreshUser: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  initializing: true,

  /** 进站时用 httpOnly 的 refresh cookie 静默换一枚 access token。 */
  bootstrap: async () => {
    try {
      const base = import.meta.env.VITE_API_BASE_URL ?? '/api';
      const res = await fetch(`${base}/auth/refresh`, { method: 'POST', credentials: 'include' });
      if (res.ok) {
        const payload = (await res.json()) as { data?: { accessToken: string; user: CurrentUser } };
        if (payload.data) {
          setAccessToken(payload.data.accessToken);
          set({ user: payload.data.user });
        }
      }
    } catch {
      /* 未登录，走游客态 */
    } finally {
      set({ initializing: false });
    }
  },

  login: async (identifier, password, remember = true) => {
    const session = await authApi.login({ identifier, password, remember });
    setAccessToken(session.accessToken);
    set({ user: session.user });
  },

  register: async (input) => {
    const session = await authApi.register(input);
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

  setUser: (user) => set({ user }),

  refreshUser: async () => {
    if (!get().user) return;
    try {
      set({ user: await authApi.me() });
    } catch {
      /* token 失效时由 onUnauthorized 统一清理 */
    }
  },
}));

setUnauthorizedHandler(() => {
  useAuthStore.setState({ user: null });
});
