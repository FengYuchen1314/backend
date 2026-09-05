import type { ResolvedProxyConfig } from '../resolve-proxy/interfaces';

import type { TTopology, TTopologyGraph } from '@libs/contracts/models';

import type { BoundSubscriptionTopology } from '@modules/topologies/topology-subscription.service';

export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export function proxy(n: number): ResolvedProxyConfig {
    return {
        finalRemark: `ordinary-${n}`,
        address: '127.0.0.1',
        port: 21000 + n,
        protocol: 'socks',
        protocolOptions: { username: `user-${n}`, password: `private-${n}` },
        transport: 'tcp',
        transportOptions: { header: null },
        security: 'none',
        streamOverrides: { finalMask: null, sockopt: null },
        mux: null,
        clientOverrides: {
            shuffleHost: false,
            mihomoX25519: false,
            mihomoIpVersion: null,
            serverDescription: null,
            xrayJsonTemplate: null,
            mapper: {},
        },
        metadata: {
            uuid: id(100 + n),
            tags: [],
            excludeFromSubscriptionTypes: [],
            inboundTag: `socks-${n}`,
            configProfileUuid: id(200 + n),
            configProfileInboundUuid: id(300 + n),
            isDisabled: false,
            isHidden: false,
            viewPosition: n,
            remark: `ordinary-${n}`,
            vlessRouteId: null,
            rawInbound: null,
        },
    };
}
export function graph(balanced = false): TTopologyGraph {
    const p = (n: number) => ({
        id: id(n),
        kind: 'PROXY' as const,
        label: `hop-${n}`,
        hostUuid: id(100 + n),
        nodeUuid: id(400 + n),
    });
    const nodes: TTopologyGraph['nodes'] = [
        { id: id(10), kind: 'ENTRY', label: 'Entry' },
        p(1),
        p(2),
        { id: id(20), kind: 'EXIT', label: 'Exit' },
    ];
    const pairs = balanced
        ? [
              [10, 1],
              [10, 2],
              [1, 30],
              [2, 30],
              [30, 3],
              [3, 20],
          ]
        : [
              [10, 1],
              [1, 2],
              [2, 20],
          ];
    if (balanced)
        nodes.push(p(3), {
            id: id(30),
            kind: 'LOAD_BALANCER',
            label: 'Balance',
            strategy: 'ROUND_ROBIN',
        });
    return {
        schemaVersion: 1,
        nodes,
        edges: pairs.map(([from, to], i) => ({
            id: id(500 + i),
            source: id(from),
            target: id(to),
            order: i,
        })),
    };
}
export function bound(
    balanced = false,
): BoundSubscriptionTopology & { hosts: Map<string, ResolvedProxyConfig> } {
    const topology: TTopology = {
        uuid: id(999),
        name: 'Published chain',
        version: 1,
        isPublished: true,
        graph: graph(balanced),
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
    };
    return {
        topology,
        hosts: new Map([1, 2, ...(balanced ? [3] : [])].map((n) => [id(n), proxy(n)])),
    };
}
