import { z } from 'zod';

const uuidLikeSchema = z.string().trim().min(1).max(64);
const isoDateTimeSchema = z.string().datetime({ offset: true });

export const timeSlotSchema = z.enum(['morning', 'daytime', 'evening', 'night']);
export const memberPreferenceSchema = z.enum(['lead', 'assist', 'simple']);
export const memberExperienceSchema = z.enum(['beginner', 'basic', 'experienced', 'professional']);

export const familyMemberSchema = z.object({
  member_id: uuidLikeSchema,
  display_name: z.string().trim().min(1).max(20),
  role: z.string().trim().min(1).max(20),
  pin_hash: z.string().trim().min(1),
  identity_claimed: z.boolean(),
  experience: memberExperienceSchema.optional(),
  available_slots: z.array(timeSlotSchema).max(4).default([]),
  limitations: z.array(z.string().trim().min(1).max(100)).max(10).default([]),
  preference: memberPreferenceSchema.default('assist'),
  temporary_unavailable: z.boolean().default(false)
});

export const familySchema = z.object({
  family_id: uuidLikeSchema,
  display_name: z.string().trim().min(1).max(40),
  creator_member_id: uuidLikeSchema,
  members: z.array(familyMemberSchema).min(1).max(8)
});

export const inputTypeSchema = z.enum(['text', 'voice']);
export const taskStatusSchema = z.enum([
  'pending',
  'in_progress',
  'completed',
  'skipped',
  'affected',
  'cancelled'
]);

export const knowledgeNoteSchema = z.object({
  note_id: uuidLikeSchema,
  source_entry_id: z.string().trim().min(1).max(120),
  text: z.string().trim().min(1).max(300),
  kind: z.enum(['step', 'preparation', 'notice', 'safety']),
  conflict: z.boolean().default(false)
});

export const taskSchema = z.object({
  task_id: uuidLikeSchema,
  title: z.string().trim().min(1).max(50),
  raw_input: z.string().trim().min(2).max(500),
  input_type: inputTypeSchema,
  assignee_member_id: uuidLikeSchema.nullable(),
  due_at: isoDateTimeSchema.nullable(),
  duration_min: z.number().int().min(1).max(120),
  completion_criteria: z.string().trim().min(1).max(300),
  assignment_reason: z.string().trim().min(1).max(150),
  status: taskStatusSchema,
  knowledge_notes: z.array(knowledgeNoteSchema).max(10).default([]),
  safety_notice: z.string().trim().min(1).max(300).nullable(),
  manually_assigned: z.boolean().default(false),
  locked_by_user: z.boolean().default(false),
  version: z.number().int().min(1)
});

export const subtaskSchema = z.object({
  subtask_id: uuidLikeSchema,
  parent_task_id: uuidLikeSchema,
  title: z.string().trim().min(1).max(50),
  order: z.number().int().min(1).max(6),
  required: z.boolean(),
  source: z.enum(['ai', 'user', 'knowledge']),
  completed: z.boolean()
});

export const aiSubtaskDraftSchema = z.object({
  title: z.string().trim().min(1).max(50),
  order: z.number().int().min(1).max(6),
  required: z.boolean(),
  source: z.enum(['ai', 'knowledge']).default('ai')
});

export const aiTaskDecompositionSchema = z.object({
  parent_task_id: uuidLikeSchema,
  subtasks: z.array(aiSubtaskDraftSchema).min(2).max(6)
});

export const taskWithSubtasksSchema = taskSchema.extend({
  subtasks: z.array(subtaskSchema).max(6).default([])
});

export const referenceVideoAttachmentSchema = z.object({
  attachment_id: uuidLikeSchema,
  task_id: uuidLikeSchema,
  file_name: z.string().trim().min(1).max(255),
  mime_type: z.enum(['mp4', 'mov', 'webm']),
  file_size: z.number().int().positive().max(100 * 1024 * 1024),
  note: z.string().trim().max(100).optional(),
  status: z.enum(['uploading', 'processing', 'ready', 'failed', 'expired']),
  expires_at: isoDateTimeSchema
});

export const completionEventSchema = z.object({
  event_id: uuidLikeSchema,
  task_id: uuidLikeSchema,
  assignee_member_id: uuidLikeSchema.nullable(),
  actor_member_id: uuidLikeSchema,
  event_type: z.enum(['completed', 'undo', 'skipped', 'reassigned']),
  completion_source: z.enum(['self', 'substitute', 'automatic']).optional(),
  substitute_reason: z.string().trim().min(1).max(120).optional(),
  occurred_at: isoDateTimeSchema,
  task_version: z.number().int().min(1),
  idempotency_key: z.string().trim().min(1).max(120)
}).superRefine((event, ctx) => {
  if (event.event_type === 'completed' && !event.completion_source) {
    ctx.addIssue({
      code: 'custom',
      path: ['completion_source'],
      message: 'completed events require completion_source'
    });
  }
  if (event.completion_source === 'substitute' && !event.substitute_reason) {
    ctx.addIssue({
      code: 'custom',
      path: ['substitute_reason'],
      message: 'substitute completions require a reason'
    });
  }
});

export const achievementSchema = z.object({
  achievement_id: z.string().trim().min(1).max(80),
  scope: z.enum(['member', 'family']),
  owner_id: uuidLikeSchema,
  unlocked_at: isoDateTimeSchema,
  source_event_ids: z.array(uuidLikeSchema).min(1)
});

export const createTaskInputSchema = z.object({
  request_id: z.string().trim().min(1).max(120),
  family_id: uuidLikeSchema,
  creator_member_id: uuidLikeSchema,
  input_type: inputTypeSchema,
  raw_input: z.string().trim().min(2).max(500),
  reference_video_attachment_id: uuidLikeSchema.optional()
});

export const voiceTaskInputSchema = createTaskInputSchema.extend({
  input_type: z.literal('voice'),
  recording_duration_sec: z.number().int().min(1).max(60),
  transcript: z.string().trim().min(2).max(500)
});

export const aiTaskDraftSchema = z.object({
  title: z.string().trim().min(1).max(50),
  assignee_member_id: uuidLikeSchema.nullable(),
  due_at: isoDateTimeSchema.nullable(),
  duration_min: z.number().int().min(1).max(120),
  completion_criteria: z.string().trim().min(1).max(300),
  assignment_reason: z.string().trim().min(1).max(150),
  knowledge_notes: z.array(knowledgeNoteSchema).max(10).default([]),
  safety_notice: z.string().trim().min(1).max(300).nullable(),
  subtasks: z.union([z.tuple([]), z.array(aiSubtaskDraftSchema).min(2).max(6)]).default([])
});

// Legacy v1.0 video-analysis schemas. They remain exported for the existing
// experimental /api/analyze path, but are no longer the product's task source.
export const riskSchema = z.enum(['low', 'confirm', 'medical']);

export const stepSchema = z
  .object({
    id: z.string().min(1),
    order: z.number().int().min(1).max(10),
    title: z.string().min(1).max(50),
    instruction: z.string().min(1).max(500),
    startSec: z.number().int().min(0).nullable(),
    endSec: z.number().int().min(0).nullable(),
    supplies: z.array(z.string().min(1).max(30)).max(10),
    caution: z.string().max(300),
    riskLevel: riskSchema,
    userConfirmed: z.boolean()
  })
  .refine((v) => v.startSec === null || v.endSec === null || v.endSec >= v.startSec, {
    message: 'endSec must follow startSec'
  });

export const analysisSchema = z.object({
  videoId: z.string().min(1),
  topic: z.string().min(1).max(100),
  applicableScene: z.string().min(1).max(100),
  supplies: z.array(z.string()).max(20),
  cautions: z.array(z.string()).max(20),
  uncertainties: z.array(z.string()).max(20),
  steps: z.array(stepSchema).min(1).max(10)
});

export const legacyTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(50),
  sourceStepId: z.string().min(1),
  assigneeId: z.string().nullable(),
  collaboratorIds: z.array(z.string()).max(3),
  timeSlot: timeSlotSchema.nullable(),
  durationMin: z.number().int().min(1).max(120),
  assignmentReason: z.string().min(1).max(150),
  status: z.enum([
    'pending',
    'upcoming',
    'in_progress',
    'completed',
    'skipped',
    'affected',
    'cancelled'
  ]),
  lockedByUser: z.boolean(),
  riskLevel: z.enum(['low', 'confirm']),
  version: z.number().int().min(1)
});

export const legacyPlanSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['draft', 'confirmed']),
  tasks: z.array(legacyTaskSchema).max(20)
});
