import { z } from 'zod';

export const ErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.string(),
  statusCode: z.number().optional(),
  details: z.unknown().optional(),
  timestampUtcMs: z.number().default(() => Date.now())
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
