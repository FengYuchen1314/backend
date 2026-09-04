import { Logger } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { fail, ok } from '@common/types';
import { ERRORS } from '@libs/contracts/constants';

import { NodeEdgeSettingsRepository } from '../../edge/node-edge-settings.repository';
import { GetNodeEdgeSettingsQuery } from './get-node-edge-settings.query';

@QueryHandler(GetNodeEdgeSettingsQuery)
export class GetNodeEdgeSettingsHandler implements IQueryHandler<GetNodeEdgeSettingsQuery> {
    private readonly logger = new Logger(GetNodeEdgeSettingsHandler.name);

    constructor(private readonly settingsRepository: NodeEdgeSettingsRepository) {}

    async execute(query: GetNodeEdgeSettingsQuery) {
        try {
            return ok((await this.settingsRepository.read(query.nodeId)).settings);
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
