import type { FamilyMember } from '../domain/types';

export interface PublishedSubtask {
  subtask_id: string;
  parent_task_id: string;
  title: string;
  order: number;
  required: boolean;
  source: 'ai' | 'user' | 'knowledge';
  completed: boolean;
}

export interface PublishedTask {
  task_id: string;
  title: string;
  raw_input: string;
  input_type: 'text' | 'voice';
  assignee_member_id: string | null;
  due_at: string | null;
  duration_min: number;
  completion_criteria: string;
  assignment_reason: string;
  status: string;
  safety_notice: string | null;
  subtasks: PublishedSubtask[];
}

export interface TaskContext {
  requestId: string;
  rawInput: string;
  members: FamilyMember[];
  currentTime: string;
  dailyLoadMinutes?: Record<string, number>;
}

export async function publishTextTask(context: TaskContext): Promise<PublishedTask> {
  const signal = AbortSignal.timeout(7000);
  const response = await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      request: {
        request_id: context.requestId,
        family_id: 'family-demo',
        creator_member_id: 'member-mom',
        input_type: 'text',
        raw_input: context.rawInput
      },
      members: context.members,
      current_time: context.currentTime,
      daily_load_minutes: context.dailyLoadMinutes
    })
  });
  return readTaskResponse(response);
}

export async function publishVoiceTask(input: {
  requestId: string;
  audio: Blob;
  durationSec: number;
  members: FamilyMember[];
  currentTime: string;
  dailyLoadMinutes?: Record<string, number>;
}): Promise<{ transcript: string; task: PublishedTask }> {
  const form = new FormData();
  form.set('audio', input.audio, 'recording.webm');
  form.set('request_id', input.requestId);
  form.set('family_id', 'family-demo');
  form.set('creator_member_id', 'member-mom');
  form.set('recording_duration_sec', String(input.durationSec));
  form.set('members', JSON.stringify(input.members));
  form.set('current_time', input.currentTime);
  if (input.dailyLoadMinutes) {
    form.set('daily_load_minutes', JSON.stringify(input.dailyLoadMinutes));
  }

  const response = await fetch('/api/tasks/from-voice', { method: 'POST', body: form, signal: AbortSignal.timeout(22000) });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json() as Promise<{ transcript: string; task: PublishedTask }>;
}

async function readTaskResponse(response: Response): Promise<PublishedTask> {
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  const data = (await response.json()) as { task: PublishedTask };
  return data.task;
}

async function readError(response: Response): Promise<string> {
  const fallback = `请求失败：${response.status}`;
  try {
    const data = (await response.json()) as { code?: string; message?: string };
    return data.message || data.code || fallback;
  } catch {
    return fallback;
  }
}
