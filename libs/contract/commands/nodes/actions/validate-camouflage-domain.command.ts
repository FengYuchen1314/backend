import { z } from 'zod';

import { NODES_ROUTES, REST_API } from '../../../api';
import { getEndpointDetails } from '../../../constants';
import {
    CAMOUFLAGE_DOMAIN_REGIONS,
    CamouflageDomainSchema,
    CamouflageDomainValidationSchema,
} from '../../../models';

export namespace ValidateCamouflageDomainCommand {
    export const url = REST_API.NODES.ACTIONS.VALIDATE_CAMOUFLAGE_DOMAIN;
    export const TSQ_url = url(':uuid');

    export const endpointDetails = getEndpointDetails(
        NODES_ROUTES.ACTIONS.VALIDATE_CAMOUFLAGE_DOMAIN(':uuid'),
        'post',
        'Validate a camouflage domain from a Node',
        { scope: 'camouflage-domains', kind: 'write' },
    );

    export const RequestParamSchema = z.object({ uuid: z.uuid() });
    export const RequestBodySchema = z.object({
        domain: CamouflageDomainSchema,
        expectedRegion: z.enum(CAMOUFLAGE_DOMAIN_REGIONS),
    });
    export const ResponseSchema = z.object({ response: CamouflageDomainValidationSchema });

    export type RequestParam = z.infer<typeof RequestParamSchema>;
    export type RequestBody = z.infer<typeof RequestBodySchema>;
    export type Response = z.infer<typeof ResponseSchema>;
}
