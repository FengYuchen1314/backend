import { z } from 'zod';

import { NODES_ROUTES, REST_API } from '../../../api';
import { getEndpointDetails } from '../../../constants';
import {
    CAMOUFLAGE_DOMAIN_REGIONS,
    CamouflageDomainSchema,
    CamouflageDomainSeedSchema,
    CamouflageDomainValidationSchema,
} from '../../../models';

export namespace SelectCamouflageDomainCommand {
    export const url = REST_API.NODES.ACTIONS.SELECT_CAMOUFLAGE_DOMAIN;
    export const TSQ_url = url(':uuid');

    export const endpointDetails = getEndpointDetails(
        NODES_ROUTES.ACTIONS.SELECT_CAMOUFLAGE_DOMAIN(':uuid'),
        'post',
        'Select a live-validated camouflage domain',
        { scope: 'camouflage-domains', kind: 'write' },
        'Validates candidate seeds from the target Node and fails closed when none qualify.',
    );

    export const RequestParamSchema = z.object({ uuid: z.uuid() });
    export const RequestBodySchema = z.object({
        region: z.enum(CAMOUFLAGE_DOMAIN_REGIONS),
        reservedDomains: z.array(CamouflageDomainSchema).max(64).default([]),
    });
    export const ResponseSchema = z.object({
        response: z.object({
            seed: CamouflageDomainSeedSchema,
            validation: CamouflageDomainValidationSchema,
        }),
    });

    export type RequestParam = z.infer<typeof RequestParamSchema>;
    export type RequestBody = z.infer<typeof RequestBodySchema>;
    export type Response = z.infer<typeof ResponseSchema>;
}
