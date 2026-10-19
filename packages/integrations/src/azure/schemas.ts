import { z } from "zod";

// Shapes of the Azure Resource Manager responses ReleaseLens reads, after
// "Container Apps Revisions - List Revisions" (Microsoft.App, api-version 2024-03-01).
// Only the fields that are used are declared; everything else is ignored. Optional
// fields are optional because Azure omits them for some revision states.

export const ArmContainerSchema = z.object({
  name: z.string().optional(),
  image: z.string().optional(),
});

export const ArmRevisionSchema = z.object({
  name: z.string().min(1),
  properties: z.object({
    createdTime: z.string().refine((value) => !Number.isNaN(Date.parse(value)), "Invalid date"),
    active: z.boolean().optional(),
    trafficWeight: z.number().min(0).max(100).optional(),
    /** Provisioning, Provisioned, Failed, Deprovisioning, Deprovisioned */
    provisioningState: z.string().optional(),
    /** Running, Processing, Stopped, Degraded, Failed, Unknown, ... */
    runningState: z.string().optional(),
    /** Healthy, Unhealthy, None */
    healthState: z.string().optional(),
    template: z.object({ containers: z.array(ArmContainerSchema).optional() }).optional(),
  }),
});
export type ArmRevision = z.infer<typeof ArmRevisionSchema>;

export const ArmRevisionPageSchema = z.object({
  value: z.array(ArmRevisionSchema),
  nextLink: z.string().nullish(),
});

/** ARM error body: `{ "error": { "code": "...", "message": "..." } }`. Only the code is ever kept. */
export const ArmErrorSchema = z.object({ error: z.object({ code: z.string() }) });
