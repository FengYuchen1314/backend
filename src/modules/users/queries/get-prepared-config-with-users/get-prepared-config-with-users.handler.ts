import { Logger } from '@nestjs/common';
import { IQueryHandler, QueryBus, QueryHandler } from '@nestjs/cqrs';

import { HashedSet } from '@remnawave/hashed-set';

import { ManagedXrayProfile } from '@common/helpers/xray-config/managed-xray-profile';
import { XRayConfig } from '@common/helpers/xray-config/xray-config.validator';
import { fail, ok, TResult } from '@common/types';
import { ERRORS } from '@libs/contracts/constants';
import { AnyTlsConfigSchema, TAnyTlsConfig } from '@libs/contracts/models';

import { deriveAnyTlsPassword } from '@modules/anytls/anytls-identity';
import { AnyTlsMaterialService } from '@modules/anytls/anytls-material.service';
import { GetConfigProfileByUuidQuery } from '@modules/config-profiles/queries/get-config-profile-by-uuid';
import { GetSnippetsQuery } from '@modules/config-profiles/queries/get-snippets';
import { UsersRepository } from '@modules/users/repositories/users.repository';

import {
    GetPreparedConfigWithUsersQuery,
    IGetPreparedConfigWithUsersResponse,
} from './get-prepared-config-with-users.query';

@QueryHandler(GetPreparedConfigWithUsersQuery)
export class GetPreparedConfigWithUsersHandler implements IQueryHandler<
    GetPreparedConfigWithUsersQuery,
    TResult<IGetPreparedConfigWithUsersResponse>
> {
    private readonly logger = new Logger(GetPreparedConfigWithUsersHandler.name);
    constructor(
        private readonly usersRepository: UsersRepository,
        private readonly queryBus: QueryBus,
        private readonly anyTlsMaterial: AnyTlsMaterialService,
    ) {}

    async execute(
        query: GetPreparedConfigWithUsersQuery,
    ): Promise<TResult<IGetPreparedConfigWithUsersResponse>> {
        let config: XRayConfig | null = null;
        const inboundsUserSets: Map<string, HashedSet> = new Map();
        const snippetsMap: Map<string, unknown> = new Map();
        try {
            const { configProfileUuid, activeInbounds } = query;

            const configProfile = await this.queryBus.execute(
                new GetConfigProfileByUuidQuery(configProfileUuid),
            );

            const snippetsResponse = await this.queryBus.execute(new GetSnippetsQuery());

            if (!configProfile.isOk || !snippetsResponse.isOk) {
                return fail(ERRORS.INTERNAL_SERVER_ERROR);
            }

            for (const snippet of snippetsResponse.response) {
                snippetsMap.set(snippet.name, snippet.snippet);
            }

            const activeInboundsTags = new Set(activeInbounds.map((inbound) => inbound.tag));
            if (
                activeInbounds.some((inbound) => inbound.profileUuid !== configProfileUuid) ||
                activeInboundsTags.size !== activeInbounds.length
            ) {
                throw new Error(
                    'Active inbounds must belong to this profile and have unique tags.',
                );
            }

            const profile = new ManagedXrayProfile(configProfile.response.config as object);
            config = profile.xray;
            const anyTlsConfig: TAnyTlsConfig | undefined = profile.anyTls
                ? { version: 1, listeners: [] }
                : undefined;
            for (const inbound of activeInbounds.filter(
                (value) => value.type.toLowerCase() === 'anytls',
            )) {
                const definition = profile.anyTls?.listeners.find(
                    (listener) => listener.tag === inbound.tag,
                );
                if (!definition || !anyTlsConfig)
                    throw new Error('Active AnyTLS inbound is missing from its profile.');
                const material = await this.anyTlsMaterial.ensure(inbound.uuid);
                anyTlsConfig.listeners.push({
                    ...definition,
                    id: inbound.uuid,
                    wrapperPassword: material.wrapperPassword,
                    shadowPassword: material.shadowPassword,
                    tls: material.tls,
                    users: [],
                });
            }
            const anyTlsByTag = new Map(
                anyTlsConfig?.listeners.map((listener) => [listener.tag, listener]),
            );

            config.cleanInboundClients(true);

            config.processCertificates();

            config.replaceSnippets(snippetsMap);

            const configHash = config.getConfigHash();

            config.leaveInbounds(activeInboundsTags);
            const nativeTags = new Set(config.getConfig().inbounds?.map((inbound) => inbound.tag));

            const usersStream = this.usersRepository.getUsersForConfigStream(activeInbounds);

            for await (const userBatch of usersStream) {
                config.includeUserBatch(
                    userBatch.map((user) => ({
                        ...user,
                        tags: [...new Set(user.tags)].filter((tag) => nativeTags.has(tag)),
                    })),
                    inboundsUserSets,
                );
                for (const user of userBatch)
                    for (const tag of new Set(user.tags)) {
                        const listener = anyTlsByTag.get(tag);
                        if (listener)
                            listener.users.push({
                                name: String(user.id),
                                password: deriveAnyTlsPassword(user.trojanPassword, listener.id),
                            });
                    }
            }

            anyTlsConfig?.listeners.sort((left, right) => left.id.localeCompare(right.id));
            for (const listener of anyTlsConfig?.listeners ?? [])
                listener.users.sort((left, right) => left.name.localeCompare(right.name));

            for (const [tag, set] of inboundsUserSets) {
                this.logger.debug(`Inbound ${tag}: hash ${set.hash64String} and ${set.size} users`);
            }

            return ok({
                config: config.getConfig(),
                ...(anyTlsConfig ? { anyTlsConfig: AnyTlsConfigSchema.parse(anyTlsConfig) } : {}),
                hashesPayload: {
                    emptyConfig: configHash,
                    inbounds: Array.from(inboundsUserSets.entries()).map(([tag, set]) => ({
                        usersCount: set.size,
                        hash: set.hash64String,
                        tag,
                    })),
                },
            });
        } catch {
            this.logger.error(
                'Could not prepare the complete managed profile and user configuration.',
            );
            return fail(ERRORS.INTERNAL_SERVER_ERROR);
        } finally {
            config = null;
            for (const [, set] of inboundsUserSets) {
                set.clear();
            }
            inboundsUserSets.clear();
        }
    }
}
