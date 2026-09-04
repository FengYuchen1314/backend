import { Logger } from '@nestjs/common';
import { IEventHandler, EventsHandler } from '@nestjs/cqrs';

import { RemoveUsersCommand as RemoveUsersFromNodeCommandSdk } from '@remnawave/node-contract';

import { NodesQueuesService } from '@queue/_nodes';

import { NodesRepository } from '../../repositories/nodes.repository';
import { hasActiveSocksInbound } from '../socks-user-sync';
import { RemoveUsersFromNodeEvent } from './remove-users-from-node.event';

@EventsHandler(RemoveUsersFromNodeEvent)
export class RemoveUsersFromNodeHandler implements IEventHandler<RemoveUsersFromNodeEvent> {
    public readonly logger = new Logger(RemoveUsersFromNodeHandler.name);

    constructor(
        private readonly nodesRepository: NodesRepository,
        private readonly nodesQueuesService: NodesQueuesService,
    ) {}
    async handle(event: RemoveUsersFromNodeEvent) {
        try {
            const nodes = await this.nodesRepository.findConnectedNodesWithInboundsForRemoval();

            if (nodes.length === 0 || event.users.length === 0) {
                return;
            }

            const userData: RemoveUsersFromNodeCommandSdk.Request = {
                users: event.users.map((user) => ({
                    userId: user.id.toString(),
                    hashUuid: user.vlessUuid,
                })),
            };

            for (const node of nodes) {
                if (hasActiveSocksInbound(node.activeInbounds)) {
                    await this.nodesQueuesService.startNode({
                        nodeUuid: node.uuid,
                        force: true,
                        retryIfBusy: true,
                    });
                    continue;
                }

                await this.nodesQueuesService.removeUsersFromNode({
                    data: userData,
                    node: {
                        address: node.address,
                        port: node.port,
                        proxyUrl: node.proxyUrl,
                    },
                });
            }

            return;
        } catch (error) {
            this.logger.error(`Error in Event RemoveUsersFromNodeHandler: ${error}`);
        }
    }
}
