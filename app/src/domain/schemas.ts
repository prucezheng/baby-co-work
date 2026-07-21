import { z } from 'zod';

export const riskSchema = z.enum(['low', 'confirm', 'medical']);
export const timeSlotSchema = z.enum(['morning', 'daytime', 'evening', 'night']);

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

export const memberSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().trim().min(1).max(20),
  role: z.string().min(1).max(20),
  experience: z.enum(['beginner', 'basic', 'experienced', 'professional']),
  availableSlots: z.array(timeSlotSchema).max(4),
  limitations: z.array(z.string().max(100)).max(10),
  preference: z.enum(['lead', 'assist', 'simple']),
  temporaryUnavailable: z.boolean()
});

export const taskSchema = z.object({
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
  // medical 风险步骤绝不进入可执行任务，仅允许 low / confirm
  riskLevel: z.enum(['low', 'confirm']),
  version: z.number().int().min(1)
});

export const planSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['draft', 'confirmed']),
  tasks: z.array(taskSchema).max(20)
});
