/**
 * Shared utility functions for CampTools analytics engine and HTTP route handlers.
 */

export function parseCountryList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map(String).map((c) => c.trim().toLowerCase()).filter(Boolean);
  }
  if (typeof raw === 'string' && raw.trim()) {
    return raw.split(/[,\s]+/).map((c) => c.trim().toLowerCase()).filter(Boolean);
  }
  return [];
}

export function computeEmpiricalMean(arr: number[]): number {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function computeEmpiricalMedian(arr: number[]): number | null {
  if (!arr || arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const med = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return parseFloat(med.toFixed(1));
}

/**
 * Bounded concurrency async map to prevent outbound socket/FD exhaustion
 * and respect upstream rate limits (e.g. Wikimedia Commons API).
 */
export async function mapConcurrent<T, R>(
  items: T[],
  concurrencyLimit: number,
  workerFn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let currentIndex = 0;
  const poolSize = Math.max(1, Math.min(concurrencyLimit, items.length));

  const workers = Array.from({ length: poolSize }, async () => {
    while (currentIndex < items.length) {
      const idx = currentIndex++;
      results[idx] = await workerFn(items[idx], idx);
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * Memory-bounded in-memory cache with FIFO eviction.
 * Prevents monotonically growing heap memory in long-running processes.
 */
export class BoundedCache<K, V> {
  private map = new Map<K, V>();

  constructor(private maxEntries: number = 1000) {}

  get(key: K): V | undefined {
    return this.map.get(key);
  }

  set(key: K, value: V): void {
    if (this.map.size >= this.maxEntries && !this.map.has(key)) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
      }
    }
    this.map.set(key, value);
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}
