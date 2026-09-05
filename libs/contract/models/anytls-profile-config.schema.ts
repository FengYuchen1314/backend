import { z } from 'zod';

import { AnyTlsListenerSchema } from './anytls.schema';

// A profile describes routing only. The panel owns credentials/certificates separately;
// private keys, static subscriber lists and insecure transport overrides are not accepted here.
export const AnyTlsProfileListenerSchema = AnyTlsListenerSchema.pick({
    tag: true,
    wrapperPort: true,
    innerPort: true,
    camouflage: true,
}).strict();

export const AnyTlsProfileExtensionSchema = z
    .object({
        version: z.literal(1),
        listeners: z.array(AnyTlsProfileListenerSchema).max(256),
    })
    .strict()
    .superRefine((config, context) => {
        const tags = new Set<string>();
        const snis = new Set<string>();
        const ports = new Set([80, 443, 2019, 18080, 18443, 15998, 15999]);
        for (const [index, listener] of config.listeners.entries()) {
            if (tags.has(listener.tag) || snis.has(listener.camouflage.serverName))
                context.addIssue({
                    code: 'custom',
                    path: ['listeners', index],
                    message: 'AnyTLS tags and camouflage SNI must be unique.',
                });
            tags.add(listener.tag);
            snis.add(listener.camouflage.serverName);
            for (const port of [listener.wrapperPort, listener.innerPort]) {
                if (ports.has(port))
                    context.addIssue({
                        code: 'custom',
                        path: ['listeners', index],
                        message: 'AnyTLS ports overlap or are reserved.',
                    });
                ports.add(port);
            }
        }
    });

export type TAnyTlsProfileListener = z.infer<typeof AnyTlsProfileListenerSchema>;
export type TAnyTlsProfileExtension = z.infer<typeof AnyTlsProfileExtensionSchema>;
