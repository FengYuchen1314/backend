import { Injectable } from '@nestjs/common';

import {
    TTopologyFormat,
    TTopologyGraph,
    TTopologyGraphNode,
    TTopologyPreviewResult,
} from '@libs/contracts/models';

const DEFAULT_TEST_URL = 'https://www.gstatic.com/generate_204';
const DEFAULT_TEST_INTERVAL_SECONDS = 300;

@Injectable()
export class TopologyCompiler {
    public compile(graph: TTopologyGraph, format: TTopologyFormat): TTopologyPreviewResult {
        switch (format) {
            case 'MIHOMO':
                return {
                    format,
                    status: 'SUPPORTED',
                    artifact: this.compileMihomo(graph),
                };
            case 'SINGBOX': {
                const unsupported = graph.nodes.find(
                    (node) =>
                        node.kind === 'LOAD_BALANCER' &&
                        ['ROUND_ROBIN', 'CONSISTENT_HASH'].includes(node.strategy),
                );
                if (unsupported) {
                    return {
                        format,
                        status: 'UNSUPPORTED',
                        reasonCode: 'SINGBOX_LOAD_BALANCE_STRATEGY_UNSUPPORTED',
                        message:
                            'sing-box supports selector and urltest groups, but not the requested round-robin or consistent-hash semantics.',
                    };
                }
                return {
                    format,
                    status: 'SUPPORTED',
                    artifact: this.compileSingBox(graph),
                };
            }
            case 'XRAY_JSON':
                return {
                    format,
                    status: 'UNSUPPORTED',
                    reasonCode: 'XRAY_GRAPH_COMPILER_UNAVAILABLE',
                    message:
                        'The current Xray generator has no safe host-pair binding for graph balancers; no configuration was fabricated.',
                };
            case 'XRAY_BASE64':
                return {
                    format,
                    status: 'UNSUPPORTED',
                    reasonCode: 'BASE64_CANNOT_REPRESENT_TOPOLOGY',
                    message:
                        'Base64 URI subscriptions cannot represent chains or load-balancing graphs without semantic loss.',
                };
        }
    }

    private compileMihomo(graph: TTopologyGraph): Record<string, unknown> {
        const { nodesById, incoming, entry, exit, proxies, groups } = this.indexGraph(graph);
        const entryTarget = this.singlePredecessor(exit.id, incoming, nodesById);

        const proxyBindings = proxies.map((proxy) => ({
            graphNodeId: proxy.id,
            tag: proxy.label,
            selector: { hostUuid: proxy.hostUuid, nodeUuid: proxy.nodeUuid },
        }));
        const proxyPatches = proxies.flatMap((proxy) => {
            const target = this.singlePredecessor(proxy.id, incoming, nodesById);
            if (target.kind === 'ENTRY') return [];
            return [
                {
                    graphNodeId: proxy.id,
                    selector: { hostUuid: proxy.hostUuid, nodeUuid: proxy.nodeUuid },
                    set: { 'dialer-proxy': target.label },
                },
            ];
        });

        const proxyGroups = [
            {
                name: entry.label,
                type: 'select',
                proxies: [entryTarget.label],
                xboard: { graphNodeId: entry.id, role: 'ENTRY' },
            },
            ...groups.map((group) => {
                const members = (incoming.get(group.id) ?? []).map((id) => nodesById.get(id)!);
                const common = {
                    name: group.label,
                    proxies: members.map((node) => node.label),
                    xboard: { graphNodeId: group.id, role: 'LOAD_BALANCER' },
                };
                const healthCheck = {
                    url: group.testUrl ?? DEFAULT_TEST_URL,
                    interval: group.intervalSeconds ?? DEFAULT_TEST_INTERVAL_SECONDS,
                };
                switch (group.strategy) {
                    case 'ROUND_ROBIN':
                        return {
                            ...common,
                            ...healthCheck,
                            type: 'load-balance',
                            strategy: 'round-robin',
                        };
                    case 'CONSISTENT_HASH':
                        return {
                            ...common,
                            ...healthCheck,
                            type: 'load-balance',
                            strategy: 'consistent-hashing',
                        };
                    case 'URL_TEST':
                        return {
                            ...common,
                            ...healthCheck,
                            type: 'url-test',
                        };
                    case 'SELECTOR':
                        return { ...common, type: 'select' };
                }
            }),
        ];

        return {
            kind: 'MIHOMO_TOPOLOGY_INJECTION',
            schemaVersion: 1,
            entryTag: entry.label,
            proxyBindings,
            proxyPatches,
            'proxy-groups': proxyGroups,
        };
    }

    private compileSingBox(graph: TTopologyGraph): Record<string, unknown> {
        const { nodesById, incoming, entry, exit, proxies, groups } = this.indexGraph(graph);
        const entryTarget = this.singlePredecessor(exit.id, incoming, nodesById);

        const outboundBindings = proxies.map((proxy) => ({
            graphNodeId: proxy.id,
            tag: proxy.label,
            selector: { hostUuid: proxy.hostUuid, nodeUuid: proxy.nodeUuid },
        }));
        const outboundPatches = proxies.flatMap((proxy) => {
            const target = this.singlePredecessor(proxy.id, incoming, nodesById);
            if (target.kind === 'ENTRY') return [];
            return [
                {
                    graphNodeId: proxy.id,
                    selector: { hostUuid: proxy.hostUuid, nodeUuid: proxy.nodeUuid },
                    set: { detour: target.label },
                },
            ];
        });

        const outbounds = [
            {
                type: 'selector',
                tag: entry.label,
                outbounds: [entryTarget.label],
                xboard: { graphNodeId: entry.id, role: 'ENTRY' },
            },
            ...groups.map((group) => {
                const common = {
                    tag: group.label,
                    outbounds: (incoming.get(group.id) ?? []).map((id) => nodesById.get(id)!.label),
                    xboard: { graphNodeId: group.id, role: 'LOAD_BALANCER' },
                };
                if (group.strategy === 'URL_TEST') {
                    return {
                        ...common,
                        type: 'urltest',
                        url: group.testUrl ?? DEFAULT_TEST_URL,
                        interval: `${group.intervalSeconds ?? DEFAULT_TEST_INTERVAL_SECONDS}s`,
                    };
                }
                return { ...common, type: 'selector' };
            }),
        ];

        return {
            kind: 'SINGBOX_TOPOLOGY_INJECTION',
            schemaVersion: 1,
            entryTag: entry.label,
            outboundBindings,
            outboundPatches,
            outbounds,
        };
    }

    private indexGraph(graph: TTopologyGraph) {
        const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
        const incoming = new Map<string, string[]>();
        for (const edge of [...graph.edges].sort(
            (left, right) =>
                (left.order ?? Number.MAX_SAFE_INTEGER) -
                    (right.order ?? Number.MAX_SAFE_INTEGER) || left.id.localeCompare(right.id),
        )) {
            incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source]);
        }

        return {
            nodesById,
            incoming,
            entry: graph.nodes.find((node) => node.kind === 'ENTRY')!,
            exit: graph.nodes.find((node) => node.kind === 'EXIT')!,
            proxies: graph.nodes.filter((node) => node.kind === 'PROXY'),
            groups: graph.nodes.filter((node) => node.kind === 'LOAD_BALANCER'),
        };
    }

    private singlePredecessor(
        nodeId: string,
        incoming: ReadonlyMap<string, string[]>,
        nodesById: ReadonlyMap<string, TTopologyGraphNode>,
    ): TTopologyGraphNode {
        // A dialer/detour is the transport used to REACH this proxy. Thus the
        // dependency points against traffic direction, and entry selects the exit hop.
        const sources = incoming.get(nodeId) ?? [];
        if (sources.length !== 1)
            throw new Error('Ambiguous topology: use an explicit load balancer.');
        return nodesById.get(sources[0])!;
    }
}
