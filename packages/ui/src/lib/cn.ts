import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** 合并类名并消解 Tailwind 冲突（后者覆盖前者）。 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
