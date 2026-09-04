import { Logger } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { fail, ok } from '@common/types';
import { ERRORS } from '@libs/contracts/constants';
import { NodeEdgeSettingsSchema } from '@libs/contracts/models';

import { NodesRepository } from '../../repositories/nodes.repository';
import { GetNodeEdgeSettingsQuery } from './get-node-edge-settings.query';

@QueryHandler(GetNodeEdgeSettingsQuery)
export class GetNodeEdgeSettingsHandler implements IQueryHandler<GetNodeEdgeSettingsQuery> {
    private readonly logger = new Logger(GetNodeEdgeSettingsHandler.name);

    constructor(private readonly nodesRepository: NodesRepository) {}

    async execute(query: GetNodeEdgeSettingsQuery) {
        try {
            const metadata = await this.nodesRepository.findMetadataByNodeId(query.nodeId);
            const xboardEdge = isRecord(metadata) ? metadata.xboardEdge : undefined;
            return ok(NodeEdgeSettingsSchema.parse(xboardEdge ?? {}));
        } catch (error) {
            this.logger.error(error);
            return fail(
                ERRORS.CONFIG_VALIDATION_ERROR.withMessage(
                    'Node metadata field xboardEdge is invalid.',
                ),
            );
        }
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
