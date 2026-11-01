import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { migrateThemeMode, type ThemeMode } from '@videox/ui';

interface UiState {
  sidebarCollapsed: boolean;
  theme: ThemeMode;
  /** 播放页连播开关 */
  autoplayNext: boolean;
  toggleSidebar: () => void;
  setTheme: (theme: ThemeMode) => void;
  setAutoplayNext: (value: boolean) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      theme: 'dark',
      autoplayNext: true,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setTheme: (theme) => set({ theme }),
      setAutoplayNext: (autoplayNext) => set({ autoplayNext }),
    }),
    {
      name: 'videox:pc-ui',
      version: 1,
      migrate: migrateThemeMode as never,
    },
  ),
);
