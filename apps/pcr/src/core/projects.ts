// 课题管理：多课题保存/切换。索引存元数据，每课题状态独立键存储；
// KV 依赖注入（浏览器传 idb-keyval 的 get/set/del，测试传内存实现）。

export interface ProjectMeta {
  id: string;
  name: string;
  updatedAt: number;
  fileName: string;
  /** 一键分析质量分（未跑自动分析为 null） */
  score: number | null;
  rows: number;
}

export interface KV {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
}

const INDEX_KEY = 'pcr-workbench:projects:index:v1';
const stateKey = (id: string) => `pcr-workbench:project:${id}`;

export function newProjectId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `p-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function listProjects(kv: KV): Promise<ProjectMeta[]> {
  const list = (await kv.get<ProjectMeta[]>(INDEX_KEY)) ?? [];
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
}

async function upsertIndex(kv: KV, meta: ProjectMeta): Promise<void> {
  const list = await listProjects(kv);
  const next = [meta, ...list.filter((m) => m.id !== meta.id)];
  await kv.set(INDEX_KEY, next);
}

export async function saveProject(kv: KV, meta: ProjectMeta, state: unknown): Promise<void> {
  await kv.set(stateKey(meta.id), state);
  await upsertIndex(kv, { ...meta, updatedAt: Date.now() });
}

export async function loadProjectState<T>(kv: KV, id: string): Promise<T | undefined> {
  return kv.get<T>(stateKey(id));
}

export async function renameProject(kv: KV, id: string, name: string): Promise<void> {
  const list = await listProjects(kv);
  const target = list.find((m) => m.id === id);
  if (!target) return;
  await upsertIndex(kv, { ...target, name: name.trim() || target.name });
}

export async function deleteProject(kv: KV, id: string): Promise<void> {
  const list = await listProjects(kv);
  await kv.set(INDEX_KEY, list.filter((m) => m.id !== id));
  await kv.del(stateKey(id));
}
