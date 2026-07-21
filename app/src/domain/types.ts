import type { z } from 'zod';
import {
  achievementSchema,
  aiTaskDecompositionSchema,
  aiTaskDraftSchema,
  analysisSchema,
  completionEventSchema,
  createTaskInputSchema,
  familyMemberSchema,
  familySchema,
  knowledgeNoteSchema,
  legacyPlanSchema,
  legacyTaskSchema,
  referenceVideoAttachmentSchema,
  stepSchema,
  subtaskSchema,
  taskSchema,
  taskWithSubtasksSchema,
  voiceTaskInputSchema
} from './schemas';

export type FamilyMember = z.infer<typeof familyMemberSchema>;
export type Family = z.infer<typeof familySchema>;
export type KnowledgeNote = z.infer<typeof knowledgeNoteSchema>;
export type FamilyTask = z.infer<typeof taskSchema>;
export type FamilyTaskWithSubtasks = z.infer<typeof taskWithSubtasksSchema>;
export type Subtask = z.infer<typeof subtaskSchema>;
export type ReferenceVideoAttachment = z.infer<typeof referenceVideoAttachmentSchema>;
export type CompletionEvent = z.infer<typeof completionEventSchema>;
export type Achievement = z.infer<typeof achievementSchema>;
export type CreateTaskInput = z.infer<typeof createTaskInputSchema>;
export type VoiceTaskInput = z.infer<typeof voiceTaskInputSchema>;
export type AiTaskDraft = z.infer<typeof aiTaskDraftSchema>;
export type AiTaskDecomposition = z.infer<typeof aiTaskDecompositionSchema>;

export type Analysis = z.infer<typeof analysisSchema>;
export type CareStep = z.infer<typeof stepSchema>;
export type LegacyCollaborationTask = z.infer<typeof legacyTaskSchema>;
export type LegacyCollaborationPlan = z.infer<typeof legacyPlanSchema>;
