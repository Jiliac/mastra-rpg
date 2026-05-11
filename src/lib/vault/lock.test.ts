import { describe, it, expect } from 'vitest';
import { acquireMutex, releaseMutex, isLocked } from './lock';

// Each test runs against a fresh slug to avoid cross-test contamination of
// the process-global Map. We don't expose a "clear-all" helper because no
// production caller should ever need one.
const slug = (suffix: string) =>
  `test-vault-lock-${suffix}-${Math.random().toString(36).slice(2, 8)}`;

describe('lock', () => {
  it('first acquire returns true; lock is held', () => {
    const s = slug('a');
    expect(isLocked(s)).toBe(false);
    expect(acquireMutex(s)).toBe(true);
    expect(isLocked(s)).toBe(true);
    releaseMutex(s);
  });

  it('second acquire while held returns false synchronously', () => {
    const s = slug('b');
    expect(acquireMutex(s)).toBe(true);
    // Synchronous, no await. If this returned a promise we'd be in trouble.
    expect(acquireMutex(s)).toBe(false);
    releaseMutex(s);
  });

  it('release allows next acquire', () => {
    const s = slug('c');
    acquireMutex(s);
    releaseMutex(s);
    expect(isLocked(s)).toBe(false);
    expect(acquireMutex(s)).toBe(true);
    releaseMutex(s);
  });

  it('release is idempotent: calling twice does not throw', () => {
    const s = slug('d');
    acquireMutex(s);
    releaseMutex(s);
    expect(() => releaseMutex(s)).not.toThrow();
  });

  it('different slugs do not contend', () => {
    const s1 = slug('e1');
    const s2 = slug('e2');
    expect(acquireMutex(s1)).toBe(true);
    expect(acquireMutex(s2)).toBe(true);
    releaseMutex(s1);
    releaseMutex(s2);
  });

  it('try/finally semantics release even when work throws', () => {
    const s = slug('f');
    expect(acquireMutex(s)).toBe(true);
    expect(() => {
      try {
        throw new Error('boom');
      } finally {
        releaseMutex(s);
      }
    }).toThrow('boom');
    expect(isLocked(s)).toBe(false);
  });

  it('uses globalThis to survive a simulated module-cache wipe (HMR-safe)', async () => {
    const s = slug('hmr');
    expect(acquireMutex(s)).toBe(true);
    // Reach into globalThis the same way lock.ts does and assert the set
    // shape — this is the contract Next.js dev-mode HMR relies on. We can't
    // truly evict the module from vitest's cache mid-test, but we can verify
    // the global registry exists and contains the slug, which is the
    // necessary-and-sufficient HMR property.
    const g = globalThis as unknown as { __rpg_locks?: Set<string> };
    expect(g.__rpg_locks).toBeInstanceOf(Set);
    expect(g.__rpg_locks!.has(s)).toBe(true);
    releaseMutex(s);
  });
});
