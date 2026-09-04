import { Injectable, Logger } from '@nestjs/common';

import { TTopology } from '@libs/contracts/models';

import type { ResolvedProxyConfig } from '@modules/subscription-template/resolve-proxy/interfaces';

import { TopologyRepository } from './topology.repository';
import { TopologyValidator } from './topology.validator';

export interface BoundSubscriptionTopology {
    topology: TTopology;
    // Bound by graph id to the already authorized, user-specific resolved Host.
    hosts: ReadonlyMap<string, ResolvedProxyConfig>;
}

@Injectable()
export class TopologySubscriptionService {
    private readonly logger = new Logger(TopologySubscriptionService.name);
    constructor(
        private readonly repository: TopologyRepository,
        private readonly validator: TopologyValidator,
    ) {}

    async resolve(
        authorizedHosts: readonly ResolvedProxyConfig[],
    ): Promise<BoundSubscriptionTopology[]> {
        const byHost = new Map(
            authorizedHosts
                .filter((host) => !host.metadata.isDisabled)
                .map((host) => [host.metadata.uuid, host]),
        );
        const result: BoundSubscriptionTopology[] = [];
        for (const topology of await this.repository.findAll()) {
            if (!topology.isPublished) continue;
            const nodes = topology.graph.nodes.filter((node) => node.kind === 'PROXY');
            // Never fetch credentials for a missing Host or downgrade to a partial chain.
            if (nodes.some((node) => !byHost.has(node.hostUuid))) continue;
            const references = await this.repository.getReferenceSnapshot(topology.graph, true);
            if (!this.validator.validate(topology.graph, references, true).valid) {
                this.logger.warn(
                    `Published topology ${topology.uuid} has stale or invalid references; omitted.`,
                );
                continue;
            }
            result.push({
                topology,
                hosts: new Map(nodes.map((node) => [node.id, byHost.get(node.hostUuid)!])),
            });
        }
        return result;
    }
}
