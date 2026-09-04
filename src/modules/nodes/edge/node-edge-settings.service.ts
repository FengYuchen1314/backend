import { GetNodeEdgeSettingsCommand, UpdateNodeEdgeSettingsCommand } from '@contract/commands';
import { ERRORS, SERVER_TYPES } from '@contract/constants';
import { NodeEdgeStatusResponseSchema } from '@contract/models';

import { Injectable, Logger } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';

import { AxiosService } from '@common/axios';
import { fail, ok, TResult } from '@common/types';

import { GetPreparedConfigWithUsersQuery } from '@modules/users/queries/get-prepared-config-with-users';

import { NodesRepository } from '../repositories/nodes.repository';
import { prepareNodeEdge } from './node-edge-plan';
import { NodeEdgeSettingsRepository } from './node-edge-settings.repository';

@Injectable()
export class NodeEdgeSettingsService {
    private readonly logger = new Logger(NodeEdgeSettingsService.name);
    constructor(
        private readonly nodes: NodesRepository,
        private readonly settings: NodeEdgeSettingsRepository,
        private readonly query: QueryBus,
        private readonly axios: AxiosService,
    ) {}

    async get(uuid: string): Promise<TResult<GetNodeEdgeSettingsCommand.Response['response']>> {
        const node = await this.nodes.findByUUID(uuid);
        if (!node) return fail(ERRORS.NODE_NOT_FOUND);
        const saved = await this.settings.read(node.id);
        let runtime = null;
        if (
            node.isConnected &&
            !node.isDisabled &&
            !node.isConnecting &&
            node.serverType === SERVER_TYPES.PUBLIC_DIRECT
        ) {
            const result = await this.axios.getNodeEdgeStatus({
                address: node.address,
                port: node.port,
                proxyUrl: node.proxyUrl,
            });
            if (result.isOk) {
                const parsed = NodeEdgeStatusResponseSchema.safeParse({
                    response: result.response,
                });
                if (parsed.success) runtime = parsed.data.response;
            }
        }
        return ok({ ...saved, runtime });
    }

    async save(
        uuid: string,
        input: UpdateNodeEdgeSettingsCommand.RequestBody,
    ): Promise<TResult<UpdateNodeEdgeSettingsCommand.Response['response']>> {
        const node = await this.nodes.findByUUID(uuid);
        if (!node) return fail(ERRORS.NODE_NOT_FOUND);
        if (node.serverType !== SERVER_TYPES.PUBLIC_DIRECT)
            return fail(
                ERRORS.CONFIG_VALIDATION_ERROR.withMessage(
                    'Shared-443 reverse proxy requires a public-direct server.',
                ),
            );
        let config: Record<string, unknown> = { inbounds: [] };
        if (node.activeConfigProfileUuid) {
            const prepared = await this.query.execute(
                new GetPreparedConfigWithUsersQuery(
                    node.activeConfigProfileUuid,
                    node.activeInbounds,
                ),
            );
            if (!prepared.isOk) return prepared;
            config = prepared.response.config as Record<string, unknown>;
        }
        let settings: UpdateNodeEdgeSettingsCommand.RequestBody['settings'];
        try {
            // Same collision/loop/listener validation used at runtime startup.
            settings = prepareNodeEdge(
                config,
                node.activeInbounds,
                input.settings,
                node.address,
            ).settings;
        } catch (error) {
            // Never log the prepared config: it includes user credentials.
            this.logger.warn('Shared-443 desired settings could not be saved.');
            return fail(
                ERRORS.CONFIG_VALIDATION_ERROR.withMessage(
                    error instanceof Error ? error.message : 'Invalid reverse-proxy settings.',
                ),
            );
        }
        try {
            if (!(await this.settings.save(node.id, input.expectedRevision, settings)))
                return fail(ERRORS.NODE_EDGE_VERSION_CONFLICT);
            return ok({ revision: input.expectedRevision + 1, settings });
        } catch {
            this.logger.error('Reverse-proxy settings persistence failed.');
            return fail(ERRORS.INTERNAL_SERVER_ERROR);
        }
    }
}
