/**
 * Per-vault-slug in-memory mutex. Synchronous acquire/release. Contention
 * returns false (rejected, not queued).
 *
 * The lock state lives on `globalThis` so Next.js dev-mode HMR — which
 * recreates module scopes — does NOT lose held state. Spec invariant §2.
 *
 * Implementation note: a `Set<string>` (rather than `Map<string, Promise>`)
 * suffices because v0 rejects contention rather than awaiting it. A future
 * v0.5 queueing implementation can swap the inner type behind the same
 * globalThis key.
 *
 * The lock is NOT durable across process restarts; the spec's failure-matrix
 * row "workflow process crash mid-turn" accepts that the in-memory lock
 * dies with the process and the turn-counter may waste an ID.
 */

const GLOBAL_KEY = '__rpg_locks' as const;

type LockBag = { [GLOBAL_KEY]?: Set<string> };

function locks(): Set<string> {
  const g = globalThis as LockBag;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new Set<string>();
  return g[GLOBAL_KEY]!;
}

/** Try to acquire the mutex for `key` (typically a vault slug or absolute root path). */
export function acquireMutex(key: string): boolean {
  const set = locks();
  if (set.has(key)) return false;
  set.add(key);
  return true;
}

/** Release the mutex for `key`. Idempotent. */
export function releaseMutex(key: string): void {
  locks().delete(key);
}

/** Inspect whether the mutex is held. Useful for tests; production code should not branch on this. */
export function isLocked(key: string): boolean {
  return locks().has(key);
}
