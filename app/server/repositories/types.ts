// 仓储接口定义：抽象持久化层，当前实现为单进程 JSON 文件，
// 后续可替换为 Supabase / PostgreSQL 而不影响业务逻辑。
// 方法名加前缀以避免多接口同名冲突（FamilyRepository / TaskRepository 都有 create/get）。

import type { FamilyMember, FamilyTaskWithSubtasks, CompletionEvent } from '../../src/domain/types';

// ---- 家庭与成员 ----

export interface FamilyRecord {
  family_id: string;
  display_name: string;
  creator_member_id: string;
  created_at: string;
}

export interface FamilyWithMembers {
  family: FamilyRecord;
  members: FamilyMember[];
}

export interface FamilyRepository {
  getFamily(familyId: string): Promise<FamilyWithMembers | null>;
  createFamily(family: FamilyRecord, creator: FamilyMember): Promise<FamilyWithMembers>;
  addMember(familyId: string, member: FamilyMember): Promise<FamilyMember>;
  getMember(familyId: string, memberId: string): Promise<FamilyMember | null>;
  updateMember(familyId: string, memberId: string, patch: Partial<FamilyMember>): Promise<FamilyMember>;
  listMembers(familyId: string): Promise<FamilyMember[]>;
  /** 通过 member_id 查找其所属 family_id（用于 PIN 解锁） */
  findMemberById(memberId: string): Promise<{ familyId: string; member: FamilyMember } | null>;
}

// ---- 任务 ----

export interface TaskRepository {
  listTasksByFamily(familyId: string): Promise<FamilyTaskWithSubtasks[]>;
  getTask(taskId: string): Promise<FamilyTaskWithSubtasks | null>;
  createTask(task: FamilyTaskWithSubtasks): Promise<FamilyTaskWithSubtasks>;
  updateTask(taskId: string, patch: Partial<FamilyTaskWithSubtasks>): Promise<FamilyTaskWithSubtasks>;
}

// ---- 完成事件 ----

export interface EventRepository {
  listEventsByTask(taskId: string): Promise<CompletionEvent[]>;
  listEventsByFamily(familyId: string, since?: string): Promise<CompletionEvent[]>;
  appendEvent(event: CompletionEvent): Promise<CompletionEvent>;
  eventExists(idempotencyKey: string): Promise<boolean>;
}
