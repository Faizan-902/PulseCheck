import { z } from 'zod';

export const registerEndpointSchema = z.object({
  name: z.string().trim().min(1).max(100),
  url: z.string().trim().url().max(2048).superRefine((value, context) => {
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) {
        context.addIssue({ code: 'custom', message: 'Only HTTP and HTTPS URLs are allowed.' });
      }
      if (url.username || url.password) {
        context.addIssue({ code: 'custom', message: 'URLs cannot contain credentials.' });
      }
    } catch {
      context.addIssue({ code: 'custom', message: 'A valid URL is required.' });
    }
  }),
  timeoutMs: z.coerce.number().int().min(100).max(30000).optional(),
  checkIntervalSeconds: z.coerce.number().int().min(30).max(86400).optional()
}).strict();

export const endpointIdSchema = z.object({ id: z.string().uuid() });

export const checksQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50)
});
