import { z } from 'zod';

import { REST_API, SYSTEM_ROUTES } from '../../api';
import { getEndpointDetails, UPDATER_STATUS_STATES, XBOARD_UPDATE_CHANNEL } from '../../constants';

export namespace GetUpdateStatusCommand {
    export const url = REST_API.SYSTEM.UPDATES.STATUS;
    export const TSQ_url = url;

    export const endpointDetails = getEndpointDetails(
        SYSTEM_ROUTES.UPDATES.STATUS,
        'get',
        'Get panel updater status',
        { scope: 'update-status', kind: 'read' },
        'Checks the separately configured updater service. Does not execute host commands.',
    );

    export const ResponseSchema = z.object({
        response: z.object({
            configured: z.boolean(),
            reachable: z.boolean(),
            channel: z.literal(XBOARD_UPDATE_CHANNEL),
            state: z.enum(UPDATER_STATUS_STATES),
            currentVersion: z.string().nullable(),
            targetVersion: z.string().nullable(),
            updateAvailable: z.boolean().nullable(),
            lastError: z.string().nullable(),
            updatedAt: z.iso.datetime().nullable(),
        }),
    });

    export type Response = z.infer<typeof ResponseSchema>;
}
