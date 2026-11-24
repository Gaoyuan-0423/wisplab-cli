import { beforeEach, describe, expect, it } from 'vitest';
import {
  deleteProject,
  listProjects,
  loadProjectState,
  newProjectId,
  renameProject,
  saveProject,
  type KV,
  type ProjectMeta,
} from './projects';

/** 内存 KV（模拟 idb-keyval 的 get/set/del 接口） */
function mockKv(): KV {
  const store = new Map<string, unknown>();
  return {
    async get<T>(key: string) {
      return store.get(key) as T | undefined;
    },
    async set(key: string, value: unknown) {
      store.set(key, structuredClone(value));
    },
    async del(key: string) {
      store.delete(key);
    },
  };
}

let kv: KV;
beforeEach(() => {
  kv = mockKv();
});

function meta(id: string, name: string, updatedAt: number, score: number | null = null): ProjectMeta {
  return { id, name, updatedAt, fileName: `${name}.csv`, score, rows: 12 };
}

describe('课题管理', () => {
  it('newProjectId 唯一', () => {
    expect(newProjectId()).not.toBe(newProjectId());
  });

  it('保存并按更新时间倒序列出', async () => {
    await saveProject(kv, meta('a', '课题A', 1000), { x: 1 });
    await saveProject(kv, meta('b', '课题B', 2000), { x: 2 });
    const list = await listProjects(kv);
    expect(list.map((m) => m.id)).toEqual(['b', 'a']);
  });

  it('重复保存为更新（不产生重复条目）', async () => {
    await saveProject(kv, meta('a', '旧名', 1000), { v: 1 });
    await saveProject(kv, meta('a', '新名', 2000), { v: 2 });
    const list = await listProjects(kv);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('新名');
    const state = await loadProjectState<{ v: number }>(kv, 'a');
    expect(state?.v).toBe(2);
  });

  it('重命名仅改索引名称', async () => {
    await saveProject(kv, meta('a', '课题A', 1000), { v: 1 });
    await renameProject(kv, 'a', '  改名  ');
    const list = await listProjects(kv);
    expect(list[0].name).toBe('改名');
  });

  it('删除同时清索引与状态', async () => {
    await saveProject(kv, meta('a', '课题A', 1000), { v: 1 });
    await deleteProject(kv, 'a');
    expect(await listProjects(kv)).toHaveLength(0);
    expect(await loadProjectState(kv, 'a')).toBeUndefined();
  });

  it('删除不存在的课题不报错', async () => {
    await expect(deleteProject(kv, 'nope')).resolves.toBeUndefined();
  });
});
