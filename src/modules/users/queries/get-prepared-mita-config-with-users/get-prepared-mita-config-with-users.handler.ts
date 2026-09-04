import { z } from 'zod';

import { Logger } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { fail, ok, TResult } from '@common/types';
import { ERRORS } from '@libs/contracts/constants';

import { UsersRepository } from '@modules/users/repositories/users.repository';

import {
    GetPreparedMitaConfigWithUsersQuery,
    IMitaServerConfig,
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
    TResult<IMitaServerConfig>
> {
    private readonly logger = new Logger(GetPreparedMitaConfigWithUsersHandler.name);

    constructor(private readonly usersRepository: UsersRepository) {}

    async execute(query: GetPreparedMitaConfigWithUsersQuery): Promise<TResult<IMitaServerConfig>> {
        try {
            if (
                query.activeInbounds.length === 0 ||
                query.activeInbounds.some((inbound) => inbound.type.toLowerCase() !== 'mieru')
            ) {
                throw new Error('Mita runtime requires at least one Mieru inbound.');
            }

            const settings = query.activeInbounds.map((inbound) =>
                getMieruSettings(inbound.rawInbound),
            );
            const first = settings[0];

            if (
                settings.some(
                    (item) =>
                        item.loggingLevel !== first.loggingLevel ||
                        item.metricsLoggingInterval !== first.metricsLoggingInterval ||
                        item.mtu !== first.mtu ||
                        item.multiplexing !== first.multiplexing ||
                        item.handshakeMode !== first.handshakeMode ||
                        item.userHintIsMandatory !== first.userHintIsMandatory,
                )
            ) {
                throw new Error('Mieru listeners in one runtime must share server settings.');
            }

            const users: IMitaServerConfig['users'] = [];
            const usersStream = this.usersRepository.getUsersForConfigStream(query.activeInbounds);

            for await (const userBatch of usersStream) {
                for (const user of userBatch) {
                    users.push({
                        name: user.id.toString(),
                        password: user.trojanPassword,
                    });
                }
            }

            return ok({
                portBindings: settings.map((item) => ({
                    port: item.port,
                    protocol: item.transport,
                })),
                users,
                advancedSettings: {
                    metricsLoggingInterval: first.metricsLoggingInterval,
                    userHintIsMandatory: first.userHintIsMandatory,
                },
                loggingLevel: first.loggingLevel,
                mtu: first.mtu,
            });
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.INTERNAL_SERVER_ERROR);
        }
    }
}
