import { z } from 'zod';

import { REST_API, TOPOLOGIES_ROUTES } from '../../api';
import { getEndpointDetails } from '../../constants';
import {
    TOPOLOGY_FORMATS,
    TopologyGraphSchema,
    TopologyPreviewResponseSchema,
    TopologySchema,
    TopologyValidationResultSchema,
} from '../../models';

const TopologyUuidParamSchema = z.object({ uuid: z.uuid() });
const TopologyNameSchema = z
    .string()
    .trim()
    .min(2)
    .max(100)
    .refine(
        (value) =>
            [...value].every((character) => {
                const code = character.charCodeAt(0);
                return code >= 32 && code !== 127;
            }),
        'Name contains control characters',
    );

export namespace GetTopologiesCommand {
    export const url = REST_API.TOPOLOGIES.GET_ALL;
    export const TSQ_url = url;
    export const endpointDetails = getEndpointDetails(
        TOPOLOGIES_ROUTES.GET_ALL,
        'get',
        'Get all topologies',
        { scope: 'list', kind: 'read' },
    );
    export const ResponseSchema = z.object({
        response: z.object({
            topologies: z.array(TopologySchema),
            total: z.int().nonnegative(),
        }),
    });
    export type Response = z.infer<typeof ResponseSchema>;
}

export namespace GetTopologyCommand {
    export const url = REST_API.TOPOLOGIES.GET;
    export const TSQ_url = url(':uuid');
    export const endpointDetails = getEndpointDetails(
        TOPOLOGIES_ROUTES.GET(':uuid'),
        'get',
        'Get topology by uuid',
        { scope: 'get', kind: 'read' },
    );
    export const RequestParamSchema = TopologyUuidParamSchema;
    export const ResponseSchema = z.object({ response: TopologySchema });
    export type RequestParam = z.infer<typeof RequestParamSchema>;
    export type Response = z.infer<typeof ResponseSchema>;
}

export namespace CreateTopologyCommand {
    export const url = REST_API.TOPOLOGIES.CREATE;
    export const TSQ_url = url;
    export const endpointDetails = getEndpointDetails(
        TOPOLOGIES_ROUTES.CREATE,
        'post',
        'Create topology',
        { scope: 'create', kind: 'write' },
    );
    export const RequestBodySchema = z.object({
        name: TopologyNameSchema,
        graph: TopologyGraphSchema,
    });
    export const ResponseSchema = z.object({ response: TopologySchema });
    export type RequestBody = z.infer<typeof RequestBodySchema>;
    export type Response = z.infer<typeof ResponseSchema>;
}

export namespace UpdateTopologyCommand {
    export const url = REST_API.TOPOLOGIES.UPDATE;
    export const TSQ_url = url(':uuid');
    export const endpointDetails = getEndpointDetails(
        TOPOLOGIES_ROUTES.UPDATE(':uuid'),
        'patch',
        'Update topology',
        { scope: 'update', kind: 'write' },
    );
    export const RequestParamSchema = TopologyUuidParamSchema;
    export const RequestBodySchema = z
        .object({
            expectedVersion: z.int().positive(),
            name: TopologyNameSchema.optional(),
            graph: TopologyGraphSchema.optional(),
            isPublished: z.boolean().optional(),
        })
        .refine(
            (value) =>
                value.name !== undefined ||
                value.graph !== undefined ||
                value.isPublished !== undefined,
            {
                error: 'At least one of name, graph or isPublished must be provided',
            },
        );
    export const ResponseSchema = z.object({ response: TopologySchema });
    export type RequestParam = z.infer<typeof RequestParamSchema>;
    export type RequestBody = z.infer<typeof RequestBodySchema>;
    export type Response = z.infer<typeof ResponseSchema>;
}

export namespace DeleteTopologyCommand {
    export const url = REST_API.TOPOLOGIES.DELETE;
    export const TSQ_url = url(':uuid');
    export const endpointDetails = getEndpointDetails(
        TOPOLOGIES_ROUTES.DELETE(':uuid'),
        'delete',
        'Delete topology',
        { scope: 'delete', kind: 'write' },
    );
    export const RequestParamSchema = TopologyUuidParamSchema;
    export const RequestQuerySchema = z.object({
        expectedVersion: z.coerce.number().int().positive(),
    });
    export type RequestParam = z.infer<typeof RequestParamSchema>;
    export type RequestQuery = z.infer<typeof RequestQuerySchema>;
}

export namespace ValidateTopologyCommand {
    export const url = REST_API.TOPOLOGIES.ACTIONS.VALIDATE;
    export const TSQ_url = url;
    export const endpointDetails = getEndpointDetails(
        TOPOLOGIES_ROUTES.ACTIONS.VALIDATE,
        'post',
        'Validate topology graph',
        { scope: 'validate', kind: 'read' },
    );
    export const RequestBodySchema = z.object({ graph: TopologyGraphSchema });
    export const ResponseSchema = z.object({ response: TopologyValidationResultSchema });
    export type RequestBody = z.infer<typeof RequestBodySchema>;
    export type Response = z.infer<typeof ResponseSchema>;
}

export namespace PreviewTopologyCommand {
    export const url = REST_API.TOPOLOGIES.ACTIONS.PREVIEW;
    export const TSQ_url = url;
    export const endpointDetails = getEndpointDetails(
        TOPOLOGIES_ROUTES.ACTIONS.PREVIEW,
        'post',
        'Compile topology preview',
        { scope: 'preview', kind: 'read' },
    );
    export const RequestBodySchema = z.object({
        graph: TopologyGraphSchema,
        formats: z.array(z.enum(TOPOLOGY_FORMATS)).min(1).max(TOPOLOGY_FORMATS.length),
    });
    export const ResponseSchema = z.object({ response: TopologyPreviewResponseSchema });
    export type RequestBody = z.infer<typeof RequestBodySchema>;
    export type Response = z.infer<typeof ResponseSchema>;
}
