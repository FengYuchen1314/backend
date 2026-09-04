import { z } from 'zod';

import { NODES_ROUTES, REST_API } from '../../../api';
import { getEndpointDetails, SERVER_TYPES } from '../../../constants';

export namespace CreateNodeBootstrapCommand {
    export const url = REST_API.NODES.ACTIONS.CREATE_BOOTSTRAP;
    export const TSQ_url = url;

    export const endpointDetails = getEndpointDetails(
        NODES_ROUTES.ACTIONS.CREATE_BOOTSTRAP,
        'post',
        'Create a short-lived, one-time Remnawave Node bootstrap command',
        { scope: 'bootstrap', kind: 'write' },
    );

    export const RequestBodySchema = z.object({
        nodePort: z.int().min(1).max(65_535).default(2_222),
        serverType: z.enum(SERVER_TYPES).default(SERVER_TYPES.PUBLIC_DIRECT),
    });

    export const ResponseSchema = z.object({
        response: z.object({
            installCommand: z.string().min(1),
            expiresAt: z.iso.datetime(),
            expiresInSeconds: z.int().positive(),
        }),
    });

    export type RequestBody = z.infer<typeof RequestBodySchema>;
    export type Response = z.infer<typeof ResponseSchema>;
}
