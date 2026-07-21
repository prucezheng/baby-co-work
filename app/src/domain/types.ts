import type { z } from 'zod';
import { analysisSchema, memberSchema, planSchema, stepSchema, taskSchema } from './schemas';

export type Analysis = z.infer<typeof analysisSchema>;
export type CareStep = z.infer<typeof stepSchema>;
export type FamilyMember = z.infer<typeof memberSchema>;
export type CollaborationTask = z.infer<typeof taskSchema>;
export type CollaborationPlan = z.infer<typeof planSchema>;
