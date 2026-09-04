import { z } from 'zod';

import { NODES_ROUTES, REST_API } from '../../api';
import { getEndpointDetails } from '../../constants';

export namespace RedeemNodeBootstrapCommand {
    export const url = REST_API.NODES.BOOTSTRAP.REDEEM;
    export const TSQ_url = url;

    export const endpointDetails = getEndpointDetails(
        NODES_ROUTES.BOOTSTRAP.REDEEM,
        'post',
        'Redeem a one-time Remnawave Node bootstrap token',
        { scope: 'bootstrap-redeem', kind: 'write' },
    );

    export const RequestBodySchema = z.object({
        token: z
            .string()
            .length(43)
            .regex(/^[A-Za-z0-9_-]+$/),
    });

    export type RequestBody = z.infer<typeof RequestBodySchema>;
}
