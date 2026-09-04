import { z } from 'zod';

export const MieruListenerSchema = z
    .object({
        tag: z
            .string()
            .min(1)
            .max(64)
            .refine((tag) => !tag.includes(','), "Character ',' is not allowed in listener tag"),
        port: z.int().min(1_025).max(65_535),
        protocol: z.enum(['TCP', 'UDP']).default('TCP'),
    })
    .strict();

export const MieruProfileConfigSchema = z
    .object({
        runtime: z.literal('MIERU'),
        listeners: z.array(MieruListenerSchema).min(1).max(128),
        mtu: z.int().min(1_280).max(1_500).default(1_400),
        multiplexing: z.literal('MULTIPLEXING_LOW').default('MULTIPLEXING_LOW'),
        handshakeMode: z.literal('HANDSHAKE_STANDARD').default('HANDSHAKE_STANDARD'),
        userHintIsMandatory: z.literal(true).default(true),
        metricsLoggingInterval: z.literal('1m').default('1m'),
        loggingLevel: z.enum(['FATAL', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE']).default('INFO'),
    })
    .strict()
    .superRefine((config, context) => {
        const tags = new Set<string>();
        const bindings = new Set<string>();

        for (const [index, listener] of config.listeners.entries()) {
            if (tags.has(listener.tag)) {
                context.addIssue({
                    code: 'custom',
                    message: `Duplicate Mieru listener tag "${listener.tag}"`,
                    path: ['listeners', index, 'tag'],
                });
            }
            tags.add(listener.tag);

            const binding = `${listener.protocol}:${listener.port}`;
            if (bindings.has(binding)) {
                context.addIssue({
                    code: 'custom',
                    message: `Duplicate Mieru listener binding "${binding}"`,
                    path: ['listeners', index, 'port'],
                });
            }
            bindings.add(binding);
        }
    });

export type TMieruListener = z.infer<typeof MieruListenerSchema>;
export type TMieruProfileConfig = z.infer<typeof MieruProfileConfigSchema>;
