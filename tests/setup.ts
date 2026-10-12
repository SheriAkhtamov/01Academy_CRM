class MemoryStorage {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
}

const memoryStorage = new MemoryStorage();

// Node 26 adds an experimental unconfigured localStorage to globalThis which shadows jsdom or is undefined.
// Ensure a functional localStorage is available on both globalThis and window.
try {
  const target = typeof window !== 'undefined' ? (window.localStorage ?? memoryStorage) : memoryStorage;
  Object.defineProperty(globalThis, 'localStorage', {
    value: target,
    configurable: true,
    writable: true,
  });
  if (typeof window !== 'undefined' && !window.localStorage) {
    Object.defineProperty(window, 'localStorage', {
      value: target,
      configurable: true,
      writable: true,
    });
  }
} catch {
  // ignore
}
