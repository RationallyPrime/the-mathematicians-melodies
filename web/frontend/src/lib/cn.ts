import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merge conditional class lists, with later Tailwind utilities winning
 *  conflicts (twMerge dedupes e.g. `px-2 px-4` → `px-4`). The single class
 *  helper every primitive and surface uses. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
