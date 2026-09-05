import { Logger } from '@nestjs/common';
import { IEventHandler, EventsHandler } from '@nestjs/cqrs';

import { RemoveUserCommand as RemoveUserFromNodeCommandSdk } from '@remnawave/node-contract';

import { NodesQueuesService } from '@queue/_nodes';

import { NodesRepository } from '../../repositories/nodes.repository';
import { requiresFullUserSyncReload } from '../socks-user-sync';
import { RemoveUserFromNodeEvent } from './remove-user-from-node.event';

@EventsHandler(RemoveUserFromNodeEvent)
export class RemoveUserFromNodeHandler implements IEventHandler<RemoveUserFromNodeEvent> {
    public readonly logger = new Logger(RemoveUserFromNodeHandler.name);

    constructor(
        private readonly nodesRepository: NodesRepository,
        private readonly nodesQueuesService: NodesQueuesService,
    ) {}
    async handle(event: RemoveUserFromNodeEvent) {
        try {
            const nodes = await this.nodesRepository.findConnectedNodesWithInboundsForRemoval();

            if (nodes.length === 0) {
                return;
            }

            const userData: RemoveUserFromNodeCommandSdk.Request = {
                username: event.id.toString(),
                hashData: {
                    vlessUuid: event.vlessUuid,
                },
            };

            const nodesForHotReload = [];

            for (const node of nodes) {
                if (requiresFullUserSyncReload(node.activeInbounds, node.serverType)) {
                    await this.nodesQueuesService.startNode({
                        nodeUuid: node.uuid,
                        force: true,
                        retryIfBusy: true,
                    });
                    continue;
                }

                nodesForHotReload.push(node);
            }

            if (nodesForHotReload.length > 0) {
                await this.nodesQueuesService.removeUserFromNodeBulk(
                    nodesForHotReload.map((node) => ({
                        data: userData,
                        node: {
                            address: node.address,
                            port: node.port,
                            proxyUrl: node.proxyUrl,
                        },
                    })),
                );
            }

            return;
        } catch (error) {
            this.logger.error(`Error in Event RemoveUserFromNodeHandler: ${error}`);
        }
    }
}
