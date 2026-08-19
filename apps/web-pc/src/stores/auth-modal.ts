import { create } from 'zustand';

export type AuthModalMode = 'login' | 'register';

function safeRedirect(path: string | null | undefined): string {
  if (!path) return '/';
  if (!path.startsWith('/') || path.startsWith('//')) return '/';
  return path;
}

interface AuthModalState {
  open: boolean;
  mode: AuthModalMode;
  redirect: string;
  openAuth: (mode: AuthModalMode, redirect?: string | null) => void;
  closeAuth: () => void;
  setMode: (mode: AuthModalMode) => void;
}

export const useAuthModalStore = create<AuthModalState>((set) => ({
  open: false,
  mode: 'login',
  redirect: '/',
  openAuth: (mode, redirect) => set({ open: true, mode, redirect: safeRedirect(redirect) }),
  closeAuth: () => set({ open: false }),
  setMode: (mode) => set({ mode }),
}));
