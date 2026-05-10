/**
 * Vitest global setup: between test suites, clear crawlee's StorageManager
 * caches and in-memory storage caches so that each describe block that calls
 * purgeDefaultStorages() starts with a clean slate.
 */
import { MemoryStorage } from '@crawlee/memory-storage';
import { Configuration } from '@crawlee/core';
import { StorageManager } from '@crawlee/core';
import { afterEach } from 'vitest';

const originalPurge = MemoryStorage.prototype.purge;

MemoryStorage.prototype.purge = async function patchedPurge(this: InstanceType<typeof MemoryStorage>) {
  // Clear all in-memory caches before the filesystem purge so that stale
  // file-backed entries pointing to moved/deleted paths are discarded.
  (this as any).keyValueStoresHandled.length = 0;
  (this as any).datasetClientsHandled.length = 0;
  (this as any).requestQueuesHandled.length = 0;
  await originalPurge.call(this);
};

afterEach(() => {
  // After each test, clear StorageManager caches so the next describe block
  // opens fresh storage instances rather than reusing stale ones.
  StorageManager.clearCache();
  Configuration.resetGlobalState();
});
