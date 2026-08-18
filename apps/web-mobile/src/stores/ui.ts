import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ThemeMode } from '@videox/ui';

interface UiState {
  theme: ThemeMode;
  /** 每个 Tab 的滚动位置，切回来时恢复——这是原生 APP 的默认行为 */
  scrollPositions: Record<string, number>;
  setTheme: (theme: ThemeMode) => void;
  rememberScroll: (key: string, offset: number) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: 'system',
      scrollPositions: {},
      setTheme: (theme) => set({ theme }),
      rememberScroll: (key, offset) =>
        set((state) => ({ scrollPositions: { ...state.scrollPositions, [key]: offset } })),
    }),
    {
      name: 'videox:mobile-ui',
      // 滚动位置是会话级的，持久化到下次进站反而莫名其妙。
      partialize: (state) => ({ theme: state.theme }) as UiState,
    },
  ),
);
