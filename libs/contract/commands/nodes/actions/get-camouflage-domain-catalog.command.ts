import { z } from 'zod';

import { NODES_ROUTES, REST_API } from '../../../api';
import { getEndpointDetails } from '../../../constants';
import { CamouflageDomainCatalogEntrySchema, CamouflageDomainSchema } from '../../../models';

export namespace GetCamouflageDomainCatalogCommand {
    export const url = REST_API.NODES.ACTIONS.CAMOUFLAGE_DOMAINS_CATALOG;
    export const TSQ_url = url;

    export const endpointDetails = getEndpointDetails(
        NODES_ROUTES.ACTIONS.CAMOUFLAGE_DOMAINS_CATALOG,
        'get',
        'List camouflage domain discovery seeds',
        { scope: 'camouflage-domains', kind: 'read' },
        'Seeds are expiring discovery hints only. Automatic selection requires a fresh validation from the target Node Agent.',
    );

    export const RequestQuerySchema = z.object({
        nodeUuid: z.uuid().optional(),
    });

    export const ResponseSchema = z.object({
        response: z.object({
            catalogVersion: z.string(),
            requiresTargetNodeValidation: z.literal(true),
            policy: z.object({
                successCacheSeconds: z.int().positive(),
                failureCacheSeconds: z.int().positive(),
                mainlandEvidenceSeconds: z.int().positive(),
                minimumCertificateValidityDays: z.literal(14),
                minimumDistinctMainlandProbeAsns: z.literal(2),
                fallback: z.literal('USER_OWNED_DOMAIN_REQUIRED'),
            }),
            occupiedDomains: z.array(CamouflageDomainSchema),
            seeds: z.array(CamouflageDomainCatalogEntrySchema),
        }),
    });

    export type RequestQuery = z.infer<typeof RequestQuerySchema>;
    export type Response = z.infer<typeof ResponseSchema>;
}
