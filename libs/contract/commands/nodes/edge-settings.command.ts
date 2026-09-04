import { z } from 'zod';

import { REST_API } from '../../api';
import { getEndpointDetails } from '../../constants';
import { NodeEdgeSettingsSchema, NodeEdgeStatusResponseSchema } from '../../models';

const params = z.object({ uuid: z.uuid() });
const saved = z.object({ revision: z.int().min(0), settings: NodeEdgeSettingsSchema });

export namespace GetNodeEdgeSettingsCommand {
    export const url = (uuid: string) => `${REST_API.NODES.GET_BY_UUID(uuid)}/edge-settings`;
    export const TSQ_url = url(':uuid');
    export const endpointDetails = getEndpointDetails(
        ':uuid/edge-settings',
        'get',
        'Get shared-443 reverse-proxy settings',
        { scope: 'edge-settings', kind: 'read' },
    );
    export const RequestParamSchema = params;
    export const ResponseSchema = z.object({
        response: saved.extend({ runtime: NodeEdgeStatusResponseSchema.shape.response.nullable() }),
    });
    export type Response = z.infer<typeof ResponseSchema>;
}

export namespace UpdateNodeEdgeSettingsCommand {
    export const url = GetNodeEdgeSettingsCommand.url;
    export const TSQ_url = url(':uuid');
    export const endpointDetails = getEndpointDetails(
        ':uuid/edge-settings',
        'put',
        'Save shared-443 reverse-proxy settings',
        { scope: 'edge-settings', kind: 'write' },
        'Saves desired settings only. Apply using the existing node restart action; saving is not runtime confirmation.',
    );
    export const RequestParamSchema = params;
    export const RequestBodySchema = z
        .object({
            expectedRevision: z.int().min(0).max(2147483646),
            settings: NodeEdgeSettingsSchema,
        })
        .strict();
    export const ResponseSchema = z.object({ response: saved });
    export type RequestBody = z.infer<typeof RequestBodySchema>;
    export type Response = z.infer<typeof ResponseSchema>;
}
