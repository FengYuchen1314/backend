import { z } from 'zod';

import { REST_API, SYSTEM_ROUTES } from '../../api';
import { getEndpointDetails, UPDATER_TRIGGER_STATES, XBOARD_UPDATE_CHANNEL } from '../../constants';

export namespace TriggerUpdateCommand {
    export const url = REST_API.SYSTEM.UPDATES.TRIGGER;
    export const TSQ_url = url;

    export const endpointDetails = getEndpointDetails(
        SYSTEM_ROUTES.UPDATES.TRIGGER,
        'post',
        'Trigger a panel update',
        { scope: 'trigger-update', kind: 'write' },
        'Requests an update on the fixed xboard-dev channel through the configured updater service.',
    );

    export const ResponseSchema = z.object({
        response: z.discriminatedUnion('accepted', [
            z.object({
                accepted: z.literal(true),
                channel: z.literal(XBOARD_UPDATE_CHANNEL),
                state: z.enum({
                    QUEUED: UPDATER_TRIGGER_STATES.QUEUED,
                    UPDATING: UPDATER_TRIGGER_STATES.UPDATING,
                }),
                operationId: z.string(),
                message: z.string().nullable(),
            }),
            z.object({
                accepted: z.literal(false),
                channel: z.literal(XBOARD_UPDATE_CHANNEL),
                state: z.enum({
                    UNCONFIGURED: UPDATER_TRIGGER_STATES.UNCONFIGURED,
                    UNREACHABLE: UPDATER_TRIGGER_STATES.UNREACHABLE,
                    UPDATING: UPDATER_TRIGGER_STATES.UPDATING,
                    REJECTED: UPDATER_TRIGGER_STATES.REJECTED,
                }),
                operationId: z.string().nullable(),
                message: z.string().nullable(),
            }),
        ]),
    });

    export type Response = z.infer<typeof ResponseSchema>;
}
