import { z } from 'zod';

import { Logger } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { fail, ok, TResult } from '@common/types';
import { ERRORS } from '@libs/contracts/constants';

import { UsersRepository } from '@modules/users/repositories/users.repository';

import {
    GetPreparedMitaConfigWithUsersQuery,
    IMitaRuntimeConfig,
} from './get-prepared-mita-config-with-users.query';

const MieruInboundSettingsSchema = z.object({
    handshakeMode: z.literal('HANDSHAKE_STANDARD'),
    loggingLevel: z.enum(['FATAL', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE']),
    metricsLoggingInterval: z.literal('1m'),
    mtu: z.int().min(1_280).max(1_500),
    multiplexing: z.literal('MULTIPLEXING_LOW'),
    port: z.int().min(1_025).max(65_535),
    transport: z.enum(['TCP', 'UDP']),
    userHintIsMandatory: z.literal(true),
});

type MieruInboundSettings = z.infer<typeof MieruInboundSettingsSchema>;

function getMieruSettings(rawInbound: object | null): MieruInboundSettings {
    const raw = rawInbound as { protocol?: unknown; settings?: unknown } | null;
    if (raw?.protocol !== 'mieru' || typeof raw.settings !== 'object' || raw.settings === null) {
        throw new Error('Invalid Mieru inbound payload.');
    }

    return MieruInboundSettingsSchema.parse(raw.settings);
}

@QueryHandler(GetPreparedMitaConfigWithUsersQuery)
export class GetPreparedMitaConfigWithUsersHandler implements IQueryHandler<
    GetPreparedMitaConfigWithUsersQuery,
    TResult<IMitaRuntimeConfig>
> {
    private readonly logger = new Logger(GetPreparedMitaConfigWithUsersHandler.name);

    constructor(private readonly usersRepository: UsersRepository) {}

    async execute(
        query: GetPreparedMitaConfigWithUsersQuery,
    ): Promise<TResult<IMitaRuntimeConfig>> {
        try {
            if (
                query.activeInbounds.length === 0 ||
                query.activeInbounds.some((inbound) => inbound.type.toLowerCase() !== 'mieru')
            ) {
                throw new Error('Mita runtime requires at least one Mieru inbound.');
            }

            const instances: IMitaRuntimeConfig['instances'] = query.activeInbounds.map(
                (inbound) => {
                    const settings = getMieruSettings(inbound.rawInbound);
                    return {
                        id: inbound.uuid,
                        config: {
                            portBindings: [{ port: settings.port, protocol: settings.transport }],
                            users: [],
                            advancedSettings: {
                                metricsLoggingInterval: settings.metricsLoggingInterval,
                                userHintIsMandatory: settings.userHintIsMandatory,
                            },
                            loggingLevel: settings.loggingLevel,
                            mtu: settings.mtu,
                        },
                    };
                },
            );
            const instanceByTag = new Map(
                query.activeInbounds.map((inbound, index) => [inbound.tag, instances[index]]),
            );
            const usersStream = this.usersRepository.getUsersForConfigStream(query.activeInbounds);

            for await (const userBatch of usersStream) {
                for (const user of userBatch) {
                    for (const tag of new Set(user.tags)) {
                        instanceByTag.get(tag)?.config.users.push({
                            name: user.id.toString(),
                            password: user.trojanPassword,
                        });
                    }
                }
            }

            return ok({
                kind: 'ISOLATED_LISTENERS',
                instances: instances.sort((left, right) => left.id.localeCompare(right.id)),
            });
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.INTERNAL_SERVER_ERROR);
        }
    }
}
