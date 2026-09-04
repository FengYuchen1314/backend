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
        const { nodesById, outgoing, incoming, entry, proxies, groups } = this.indexGraph(graph);
        const entryTarget = this.resolveEntryTarget(entry.id, groups, outgoing, nodesById);

        const proxyBindings = proxies.map((proxy) => ({
            graphNodeId: proxy.id,
            tag: proxy.label,
            selector: { hostUuid: proxy.hostUuid, nodeUuid: proxy.nodeUuid },
        }));
        const proxyPatches = proxies.flatMap((proxy) => {
            const target = this.resolveProxyTarget(proxy.id, outgoing, nodesById);
            if (target.kind === 'EXIT') return [];
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
                const members = this.resolveGroupMembers(
                    group.id,
                    entry.id,
                    outgoing,
                    incoming,
                    nodesById,
                );
                const common = {
                    name: group.label,
                    proxies: members.map((node) => node.label),
                    xboard: { graphNodeId: group.id, role: 'LOAD_BALANCER' },
                };
                switch (group.strategy) {
                    case 'ROUND_ROBIN':
                        return { ...common, type: 'load-balance', strategy: 'round-robin' };
                    case 'CONSISTENT_HASH':
                        return { ...common, type: 'load-balance', strategy: 'consistent-hashing' };
                    case 'URL_TEST':
                        return {
                            ...common,
                            type: 'url-test',
                            url: group.testUrl ?? DEFAULT_TEST_URL,
                            interval: group.intervalSeconds ?? DEFAULT_TEST_INTERVAL_SECONDS,
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
        const { nodesById, outgoing, incoming, entry, proxies, groups } = this.indexGraph(graph);
        const entryTarget = this.resolveEntryTarget(entry.id, groups, outgoing, nodesById);

        const outboundBindings = proxies.map((proxy) => ({
            graphNodeId: proxy.id,
            tag: proxy.label,
            selector: { hostUuid: proxy.hostUuid, nodeUuid: proxy.nodeUuid },
        }));
        const outboundPatches = proxies.flatMap((proxy) => {
            const target = this.resolveProxyTarget(proxy.id, outgoing, nodesById);
            if (target.kind === 'EXIT') return [];
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
                    outbounds: this.resolveGroupMembers(
                        group.id,
                        entry.id,
                        outgoing,
                        incoming,
                        nodesById,
                    ).map((node) => node.label),
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
        const outgoing = new Map<string, string[]>();
        const incoming = new Map<string, string[]>();
        for (const edge of [...graph.edges].sort(
            (left, right) =>
                (left.order ?? Number.MAX_SAFE_INTEGER) -
                    (right.order ?? Number.MAX_SAFE_INTEGER) || left.id.localeCompare(right.id),
        )) {
            outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
            incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source]);
        }

        return {
            nodesById,
            outgoing,
            incoming,
            entry: graph.nodes.find((node) => node.kind === 'ENTRY')!,
            proxies: graph.nodes.filter((node) => node.kind === 'PROXY'),
            groups: graph.nodes.filter((node) => node.kind === 'LOAD_BALANCER'),
        };
    }

    private resolveEntryTarget(
        entryId: string,
        groups: Extract<TTopologyGraphNode, { kind: 'LOAD_BALANCER' }>[],
        outgoing: ReadonlyMap<string, string[]>,
        nodesById: ReadonlyMap<string, TTopologyGraphNode>,
    ): TTopologyGraphNode {
        const branchRoots = outgoing.get(entryId) ?? [];
        if (branchRoots.length === 1) return nodesById.get(branchRoots[0])!;

        return groups.find((group) =>
            branchRoots.every((root) =>
                this.proxyBranchReachesGroup(root, group.id, outgoing, nodesById),
            ),
        )!;
    }

    private resolveGroupMembers(
        groupId: string,
        entryId: string,
        outgoing: ReadonlyMap<string, string[]>,
        incoming: ReadonlyMap<string, string[]>,
        nodesById: ReadonlyMap<string, TTopologyGraphNode>,
    ): TTopologyGraphNode[] {
        const branchRoots = (outgoing.get(entryId) ?? []).filter((root) =>
            this.proxyBranchReachesGroup(root, groupId, outgoing, nodesById),
        );
        const memberIds = branchRoots.length >= 2 ? branchRoots : (incoming.get(groupId) ?? []);
        return memberIds.map((id) => nodesById.get(id)!);
    }

    private proxyBranchReachesGroup(
        rootId: string,
        groupId: string,
        outgoing: ReadonlyMap<string, string[]>,
        nodesById: ReadonlyMap<string, TTopologyGraphNode>,
    ): boolean {
        let currentId = rootId;
        const visited = new Set<string>();
        while (!visited.has(currentId)) {
            visited.add(currentId);
            const current = nodesById.get(currentId);
            if (current?.kind !== 'PROXY') return false;
            const nextId = outgoing.get(currentId)?.[0];
            if (!nextId) return false;
            if (nextId === groupId) return true;
            if (nodesById.get(nextId)?.kind !== 'PROXY') return false;
            currentId = nextId;
        }
        return false;
    }

    private resolveProxyTarget(
        proxyId: string,
        outgoing: ReadonlyMap<string, string[]>,
        nodesById: ReadonlyMap<string, TTopologyGraphNode>,
    ): TTopologyGraphNode {
        const target = this.singleTarget(proxyId, outgoing, nodesById);
        return target.kind === 'LOAD_BALANCER'
            ? this.singleTarget(target.id, outgoing, nodesById)
            : target;
    }

    private singleTarget(
        sourceId: string,
        outgoing: ReadonlyMap<string, string[]>,
        nodesById: ReadonlyMap<string, TTopologyGraphNode>,
    ): TTopologyGraphNode {
        return nodesById.get(outgoing.get(sourceId)![0])!;
    }
}
