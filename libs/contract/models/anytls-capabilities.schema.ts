import { z } from 'zod';

export const ANYTLS_CAPABILITIES_PATH = '/node/anytls/capabilities' as const;
export const AnyTlsCapabilitiesSchema = z
    .object({
        available: z.boolean(),
        coordinatedStartVersion: z.literal(1).nullable(),
    })
    .strict()
    .refine((value) => value.coordinatedStartVersion === null || value.available, {
        message: 'Coordinated AnyTLS must be available.',
    });
export type TAnyTlsCapabilities = z.infer<typeof AnyTlsCapabilitiesSchema>;
