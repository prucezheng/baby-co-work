// 单进程 JSON 文件持久化：同时实现 FamilyRepository、TaskRepository、EventRepository。
// 数据结构用 family → members、task_id → task、task_id → events 三层映射，
// 写入时先写临时文件再原子 rename，避免断电损坏。

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FamilyMember, FamilyTaskWithSubtasks, CompletionEvent } from '../../src/domain/types';
import type {
  FamilyRecord,
  FamilyWithMembers,
  FamilyRepository,
  TaskRepository,
  EventRepository
} from './types';

// ---- 磁盘数据结构 ----

interface StoreData {
  version: 1;
  families: Record<string, {
    family: FamilyRecord;
    members: Record<string, FamilyMember>;
  }>;
  tasks: Record<string, FamilyTaskWithSubtasks>;
  /** key = task_id，events 按 occurred_at 升序 */
  events: Record<string, CompletionEvent[]>;
  /** 幂等键集合，防重复写入 */
  idempotencyKeys: Record<string, true>;
}

function emptyStore(): StoreData {
  return { version: 1, families: {}, tasks: {}, events: {}, idempotencyKeys: {} };
}

// ---- 仓储实现 ----

export class JsonRepository implements FamilyRepository, TaskRepository, EventRepository {
  private store: StoreData;
  private filePath: string;
  private ready: Promise<void>;
  private memoryOnly: boolean;

  constructor(dataDir: string) {
    this.memoryOnly = dataDir === ':memory:';
    this.filePath = this.memoryOnly ? '' : join(dataDir, 'store.json');
    this.store = emptyStore();
    this.ready = this.memoryOnly ? Promise.resolve() : this.load();
  }

  /** 等待数据加载完成（服务启动时调用一次即可） */
  async waitReady(): Promise<void> {
    await this.ready;
  }

  // ========== FamilyRepository ==========

  async getFamily(familyId: string): Promise<FamilyWithMembers | null> {
    await this.ready;
    const entry = this.store.families[familyId];
    if (!entry) return null;
    return {
      family: entry.family,
      members: Object.values(entry.members)
    };
  }

  async createFamily(family: FamilyRecord, creator: FamilyMember): Promise<FamilyWithMembers> {
    await this.ready;
    this.store.families[family.family_id] = {
      family,
      members: { [creator.member_id]: creator }
    };
    await this.save();
    return { family, members: [creator] };
  }

  async addMember(familyId: string, member: FamilyMember): Promise<FamilyMember> {
    await this.ready;
    const entry = this.store.families[familyId];
    if (!entry) throw new Error(`family ${familyId} not found`);
    entry.members[member.member_id] = member;
    await this.save();
    return member;
  }

  async getMember(familyId: string, memberId: string): Promise<FamilyMember | null> {
    await this.ready;
    return this.store.families[familyId]?.members[memberId] ?? null;
  }

  async updateMember(familyId: string, memberId: string, patch: Partial<FamilyMember>): Promise<FamilyMember> {
    await this.ready;
    const member = this.store.families[familyId]?.members[memberId];
    if (!member) throw new Error(`member ${memberId} not found in family ${familyId}`);
    Object.assign(member, patch);
    await this.save();
    return member;
  }

  async listMembers(familyId: string): Promise<FamilyMember[]> {
    await this.ready;
    return Object.values(this.store.families[familyId]?.members ?? {});
  }

  async findMemberById(memberId: string): Promise<{ familyId: string; member: FamilyMember } | null> {
    await this.ready;
    for (const [familyId, entry] of Object.entries(this.store.families)) {
      const member = entry.members[memberId];
      if (member) return { familyId, member };
    }
    return null;
  }

  // ========== TaskRepository ==========

  async listTasksByFamily(familyId: string): Promise<FamilyTaskWithSubtasks[]> {
    await this.ready;
    return Object.values(this.store.tasks).filter((t) => {
      const members = this.store.families[familyId]?.members;
      if (!members) return false;
      return t.assignee_member_id === null || t.assignee_member_id in members;
    });
  }

  async getTask(taskId: string): Promise<FamilyTaskWithSubtasks | null> {
    await this.ready;
    return this.store.tasks[taskId] ?? null;
  }

  async createTask(task: FamilyTaskWithSubtasks): Promise<FamilyTaskWithSubtasks> {
    await this.ready;
    this.store.tasks[task.task_id] = task;
    await this.save();
    return task;
  }

  async updateTask(taskId: string, patch: Partial<FamilyTaskWithSubtasks>): Promise<FamilyTaskWithSubtasks> {
    await this.ready;
    const task = this.store.tasks[taskId];
    if (!task) throw new Error(`task ${taskId} not found`);
    Object.assign(task, patch);
    await this.save();
    return task;
  }

  // ========== EventRepository ==========

  async listEventsByTask(taskId: string): Promise<CompletionEvent[]> {
    await this.ready;
    return this.store.events[taskId] ?? [];
  }

  async listEventsByFamily(familyId: string, since?: string): Promise<CompletionEvent[]> {
    await this.ready;
    const members = this.store.families[familyId]?.members;
    if (!members) return [];

    const allEvents: CompletionEvent[] = [];
    for (const events of Object.values(this.store.events)) {
      for (const event of events) {
        if (event.actor_member_id in members || (event.assignee_member_id && event.assignee_member_id in members)) {
          if (!since || event.occurred_at >= since) {
            allEvents.push(event);
          }
        }
      }
    }
    allEvents.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
    return allEvents;
  }

  async appendEvent(event: CompletionEvent): Promise<CompletionEvent> {
    await this.ready;
    // 幂等检查
    if (this.store.idempotencyKeys[event.idempotency_key]) {
      const existing = this.store.events[event.task_id]?.find(
        (e) => e.idempotency_key === event.idempotency_key
      );
      if (existing) return existing;
    }
    if (!this.store.events[event.task_id]) {
      this.store.events[event.task_id] = [];
    }
    this.store.events[event.task_id].push(event);
    this.store.idempotencyKeys[event.idempotency_key] = true;
    await this.save();
    return event;
  }

  async eventExists(idempotencyKey: string): Promise<boolean> {
    await this.ready;
    return idempotencyKey in this.store.idempotencyKeys;
  }

  // ========== 内部持久化 ==========

  private async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.version === 1 && parsed.families && parsed.tasks && parsed.events) {
        this.store = parsed;
        if (!this.store.idempotencyKeys) {
          this.store.idempotencyKeys = {};
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[store] 数据文件读取失败，使用空存储:', (error as Error).message);
      }
    }
  }

  private async save(): Promise<void> {
    if (this.memoryOnly) return;
    const tmpPath = this.filePath + '.' + randomUUID() + '.tmp';
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(tmpPath, JSON.stringify(this.store, null, 2), 'utf-8');
    await rename(tmpPath, this.filePath);
  }
}
