import { SERVER_TYPES } from '@contract/constants';
import { Job } from 'bullmq';

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';

import { AxiosService } from '@common/axios';

import { DeleteNodeByUuidCommand } from '@modules/nodes/commands/delete-node-by-uuid';
import { UpdateNodeCommand } from '@modules/nodes/commands/update-node';
import { GetNodeByUuidQuery } from '@modules/nodes/queries/get-node-by-uuid';

import { QUEUES_NAMES } from '@queue/queue.enum';

import { NODES_JOB_NAMES } from '../constants/nodes-job-name.constant';

@Processor(QUEUES_NAMES.NODES.STOP, {
    concurrency: 30,
})
export class StopNodeProcessor extends WorkerHost {
    private readonly logger = new Logger(StopNodeProcessor.name);

    constructor(
        private readonly axios: AxiosService,
        private readonly queryBus: QueryBus,
        private readonly commandBus: CommandBus,
    ) {
        super();
    }

    async process(job: Job<{ nodeUuid: string; isNeedToBeDeleted: boolean }>): Promise<boolean> {
        try {
            const { nodeUuid, isNeedToBeDeleted } = job.data;

            const result = await this.queryBus.execute(new GetNodeByUuidQuery(nodeUuid));

            if (!result.isOk) {
                this.logger.error(`Node ${nodeUuid} not found`);
                return false;
            }

            if (isNeedToBeDeleted) {
                await this.commandBus.execute(new DeleteNodeByUuidCommand(nodeUuid));
                return true;
            }

            const connection = {
                address: result.response.address,
                port: result.response.port,
                proxyUrl: result.response.proxyUrl,
            };
            const isMieruRuntime =
                result.response.serverType === SERVER_TYPES.LEASED_LINE ||
                (result.response.activeInbounds.length > 0 &&
                    result.response.activeInbounds.every(
                        (inbound) => inbound.type.toLowerCase() === 'mieru',
                    ));

            const stopped = isMieruRuntime
                ? await this.axios.stopMieru(connection)
                : await this.axios.stopXray(connection);
            if (!stopped.isOk || !stopped.response.isStopped) {
                await this.commandBus.execute(
                    new UpdateNodeCommand({
                        uuid: result.response.uuid,
                        lastStatusMessage: stopped.isOk
                            ? 'The node runtime did not confirm that it stopped.'
                            : 'Failed to contact the node to stop its runtime.',
                        lastStatusChange: new Date(),
                    }),
                );
                return false;
            }

            // TODO: disable plugins?

            if (!isNeedToBeDeleted) {
                await this.commandBus.execute(
                    new UpdateNodeCommand({
                        uuid: result.response.uuid,
                        lastStatusMessage: null,
                        lastStatusChange: new Date(),
                        isConnected: false,
                        isConnecting: false,
                        isDisabled: true,
                    }),
                );
            }

            return true;
        } catch (error) {
            this.logger.error(`Error handling "${NODES_JOB_NAMES.STOP_NODE}" job: ${error}`);
            return false;
        }
    }
}
