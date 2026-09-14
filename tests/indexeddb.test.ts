import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { IndexedDbAdapter } from '../src/storage/indexedDbAdapter';
import { Store } from '../src/storage/store';

describe('IndexedDbAdapter', () => {
  it('stores text, bytes and metadata', async () => {
    const a = new IndexedDbAdapter();
    await a.write('settings.json', '{"x":1}');
    await a.write('imports/index.json', '[]');
    await a.writeBinary('exports/a.bin', new Uint8Array([1, 2, 3]));
    expect(await a.read('settings.json')).toBe('{"x":1}');
    expect(await a.list()).toEqual(['settings.json']);
    expect(await a.list('imports')).toEqual(['imports/index.json']);
    expect(await a.exists('nope.json')).toBe(false);
    await a.setMeta('handle', { fake: true });
    expect(await a.getMeta('handle')).toEqual({ fake: true });
    await a.remove('settings.json');
    expect(await a.read('settings.json')).toBeNull();
    const store = new Store(a, { id: 'x', label: 'y' });
    const { data } = await store.loadAll();
    expect(data.importsIndex).toEqual([]);
  });
});
