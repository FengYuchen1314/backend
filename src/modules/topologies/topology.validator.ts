import { Injectable } from '@nestjs/common';

import {
    TTopologyGraph,
    TTopologyGraphNode,
    TTopologyIssue,
    TTopologyValidationResult,
} from '@libs/contracts/models';

import { TOPOLOGY_MAX_DEPTH } from './topology.constants';
import { TopologyReferenceSnapshot } from './topology.types';

@Injectable()
export class TopologyValidator {
    public validate(
        graph: TTopologyGraph,
        references: TopologyReferenceSnapshot,
    ): TTopologyValidationResult {
        const issues: TTopologyIssue[] = [];
        const issueKeys = new Set<string>();
        const addIssue = (issue: TTopologyIssue) => {
            const key = JSON.stringify(issue);
            if (!issueKeys.has(key)) {
                issueKeys.add(key);
                issues.push(issue);
            }
        };

        const nodesById = new Map<string, TTopologyGraphNode>();
        const duplicateNodeIds = new Set<string>();
        for (const node of graph.nodes) {
            if (nodesById.has(node.id)) duplicateNodeIds.add(node.id);
            else nodesById.set(node.id, node);
        }
        if (duplicateNodeIds.size > 0) {
            addIssue({
                code: 'DUPLICATE_NODE_ID',
                message: 'Graph node ids must be unique.',
                nodeIds: [...duplicateNodeIds],
            });
        }

        const labels = new Map<string, string[]>();
        for (const node of graph.nodes) {
            const normalized = node.label.trim().toLocaleLowerCase('en-US');
            labels.set(normalized, [...(labels.get(normalized) ?? []), node.id]);
        }
        for (const ids of labels.values()) {
            if (ids.length > 1) {
                addIssue({
                    code: 'DUPLICATE_NODE_LABEL',
                    message:
                        'Node labels must be unique because client configs address them by tag.',
                    nodeIds: ids,
                });
            }
        }

        const edgeIds = new Set<string>();
        const duplicateEdgeIds = new Set<string>();
        const edgePairs = new Map<string, string[]>();
        const outgoing = new Map<string, string[]>();
        const incoming = new Map<string, string[]>();

        for (const edge of graph.edges) {
            if (edgeIds.has(edge.id)) duplicateEdgeIds.add(edge.id);
            edgeIds.add(edge.id);

            const pair = `${edge.source}:${edge.target}`;
            edgePairs.set(pair, [...(edgePairs.get(pair) ?? []), edge.id]);

            const source = nodesById.get(edge.source);
            const target = nodesById.get(edge.target);
            if (!source || !target) {
                addIssue({
                    code: 'EDGE_REFERENCE_NOT_FOUND',
                    message: 'Every edge endpoint must reference a graph node.',
                    edgeIds: [edge.id],
                    nodeIds: [edge.source, edge.target].filter((id) => !nodesById.has(id)),
                });
                continue;
            }

            outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
            incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source]);

            if (edge.source === edge.target) {
                addIssue({
                    code: 'SELF_EDGE',
                    message: 'A node cannot connect to itself.',
                    edgeIds: [edge.id],
                    nodeIds: [edge.source],
                });
            }
            if (source.kind === 'EXIT') {
                addIssue({
                    code: 'EDGE_FROM_EXIT',
                    message: 'Exit nodes cannot have outgoing edges.',
                    edgeIds: [edge.id],
                    nodeIds: [source.id],
                });
            }
            if (target.kind === 'ENTRY') {
                addIssue({
                    code: 'EDGE_TO_ENTRY',
                    message: 'Entry nodes cannot have incoming edges.',
                    edgeIds: [edge.id],
                    nodeIds: [target.id],
                });
            }
            if (
                source.kind === 'PROXY' &&
                !['PROXY', 'LOAD_BALANCER', 'EXIT'].includes(target.kind)
            ) {
                addIssue({
                    code: 'INVALID_PROXY_SUCCESSOR',
                    message:
                        'A proxy may only chain to another proxy, a load balancer, or the exit.',
                    edgeIds: [edge.id],
                    nodeIds: [source.id, target.id],
                });
            }
            if (source.kind === 'LOAD_BALANCER' && !['PROXY', 'EXIT'].includes(target.kind)) {
                addIssue({
                    code: 'INVALID_LOAD_BALANCER_SUCCESSOR',
                    message: 'A load balancer must continue to one proxy or to the exit.',
                    edgeIds: [edge.id],
                    nodeIds: [source.id, target.id],
                });
            }
            if (target.kind === 'LOAD_BALANCER' && source.kind !== 'PROXY') {
                addIssue({
                    code: 'INVALID_LOAD_BALANCER_MEMBER',
                    message: 'Only proxy nodes can be incoming load-balancer members.',
                    edgeIds: [edge.id],
                    nodeIds: [source.id, target.id],
                });
            }
            if (source.kind === 'ENTRY' && target.kind !== 'PROXY') {
                addIssue({
                    code: 'INVALID_ENTRY_TARGET',
                    message: 'The entry must connect to one or more proxy branch roots.',
                    edgeIds: [edge.id],
                    nodeIds: [source.id, target.id],
                });
            }
        }

        if (duplicateEdgeIds.size > 0) {
            addIssue({
                code: 'DUPLICATE_EDGE_ID',
                message: 'Graph edge ids must be unique.',
                edgeIds: [...duplicateEdgeIds],
            });
        }
        for (const ids of edgePairs.values()) {
            if (ids.length > 1) {
                addIssue({
                    code: 'DUPLICATE_EDGE',
                    message: 'Only one directed edge is allowed between the same nodes.',
                    edgeIds: ids,
                });
            }
        }

        const entries = graph.nodes.filter((node) => node.kind === 'ENTRY');
        const exits = graph.nodes.filter((node) => node.kind === 'EXIT');
        const proxies = graph.nodes.filter((node) => node.kind === 'PROXY');
        const loadBalancers = graph.nodes.filter((node) => node.kind === 'LOAD_BALANCER');

        if (entries.length !== 1) {
            addIssue({
                code: 'ENTRY_COUNT',
                message: 'A topology must contain exactly one entry node.',
                nodeIds: entries.map((node) => node.id),
            });
        }
        if (exits.length !== 1) {
            addIssue({
                code: 'EXIT_COUNT',
                message: 'A topology must contain exactly one exit node.',
                nodeIds: exits.map((node) => node.id),
            });
        }
        if (proxies.length === 0) {
            addIssue({
                code: 'EMPTY_PROXY_SET',
                message: 'A topology requires at least one proxy.',
            });
        }

        for (const entry of entries) {
            if (
                (incoming.get(entry.id)?.length ?? 0) !== 0 ||
                (outgoing.get(entry.id)?.length ?? 0) < 1
            ) {
                addIssue({
                    code: 'INVALID_ENTRY_DEGREE',
                    message:
                        'The entry must have no incoming edge and at least one outgoing proxy branch.',
                    nodeIds: [entry.id],
                });
            }
        }
        for (const exit of exits) {
            if (
                (incoming.get(exit.id)?.length ?? 0) < 1 ||
                (outgoing.get(exit.id)?.length ?? 0) !== 0
            ) {
                addIssue({
                    code: 'INVALID_EXIT_DEGREE',
                    message: 'The exit must have at least one incoming edge and no outgoing edge.',
                    nodeIds: [exit.id],
                });
            }
        }
        for (const proxy of proxies) {
            if ((outgoing.get(proxy.id)?.length ?? 0) !== 1) {
                addIssue({
                    code: 'INVALID_PROXY_DEGREE',
                    message: 'Every proxy must have exactly one next hop.',
                    nodeIds: [proxy.id],
                });
            }
        }
        for (const loadBalancer of loadBalancers) {
            if (
                (incoming.get(loadBalancer.id)?.length ?? 0) < 2 ||
                (outgoing.get(loadBalancer.id)?.length ?? 0) !== 1
            ) {
                addIssue({
                    code: 'EMPTY_LOAD_BALANCER',
                    message:
                        'A load-balancing group needs at least two incoming proxy members and exactly one next hop.',
                    nodeIds: [loadBalancer.id],
                });
            }
        }

        const proxyPairs = new Map<string, string[]>();
        for (const proxy of proxies) {
            const pair = `${proxy.hostUuid}:${proxy.nodeUuid}`;
            proxyPairs.set(pair, [...(proxyPairs.get(pair) ?? []), proxy.id]);

            if (!references.nodeUuids.has(proxy.nodeUuid)) {
                addIssue({
                    code: 'PHYSICAL_NODE_NOT_FOUND',
                    message: 'The referenced physical node does not exist.',
                    nodeIds: [proxy.id],
                });
            }
            const host = references.hosts.get(proxy.hostUuid);
            if (!host) {
                addIssue({
                    code: 'HOST_NOT_FOUND',
                    message: 'The referenced host does not exist.',
                    nodeIds: [proxy.id],
                });
                continue;
            }
            if (!host.nodeUuids.has(proxy.nodeUuid)) {
                addIssue({
                    code: 'HOST_NODE_MISMATCH',
                    message: 'The referenced host is not assigned to the selected physical node.',
                    nodeIds: [proxy.id],
                });
            } else if (!host.activeInboundNodeUuids.has(proxy.nodeUuid)) {
                addIssue({
                    code: 'HOST_INBOUND_NOT_ACTIVE_ON_NODE',
                    message: 'The host inbound is not active on the selected physical node.',
                    nodeIds: [proxy.id],
                });
            }
        }
        for (const ids of proxyPairs.values()) {
            if (ids.length > 1) {
                addIssue({
                    code: 'DUPLICATE_PROXY_REFERENCE',
                    message: 'The same host and physical node pair cannot appear twice.',
                    nodeIds: ids,
                });
            }
        }

        const cycleNodes = this.findCycleNodes(nodesById, outgoing);
        if (cycleNodes.length > 0) {
            addIssue({
                code: 'DIRECTED_CYCLE',
                message: 'Proxy topology must be a directed acyclic graph.',
                nodeIds: cycleNodes,
            });
        }

        const entry = entries.length === 1 ? entries[0] : undefined;
        const exit = exits.length === 1 ? exits[0] : undefined;
        if (entry && cycleNodes.length === 0) {
            this.validateEntryBranchConvergence(entry.id, nodesById, outgoing, addIssue);
        }
        if (entry && exit) {
            const reachableFromEntry = this.walk(entry.id, outgoing);
            const canReachExit = this.walk(exit.id, incoming);
            const disconnected = graph.nodes
                .filter((node) => !reachableFromEntry.has(node.id) || !canReachExit.has(node.id))
                .map((node) => node.id);
            if (disconnected.length > 0) {
                addIssue({
                    code: 'DISCONNECTED_GRAPH',
                    message: 'Every graph node must be on a path from the entry to the exit.',
                    nodeIds: disconnected,
                });
            }
        }

        let maxDepth = 0;
        if (entry && cycleNodes.length === 0) {
            maxDepth = this.calculateMaxDepth(entry.id, outgoing);
            if (maxDepth > TOPOLOGY_MAX_DEPTH) {
                addIssue({
                    code: 'MAX_DEPTH_EXCEEDED',
                    message: `Topology depth cannot exceed ${TOPOLOGY_MAX_DEPTH} edges.`,
                });
            }
            this.validatePhysicalServerPaths(entry.id, nodesById, outgoing, addIssue);
        }

        return { valid: issues.length === 0, issues, maxDepth };
    }

    private findCycleNodes(
        nodes: ReadonlyMap<string, TTopologyGraphNode>,
        outgoing: ReadonlyMap<string, string[]>,
    ): string[] {
        const state = new Map<string, 0 | 1 | 2>();
        const stack: string[] = [];
        const inCycle = new Set<string>();

        const visit = (id: string) => {
            state.set(id, 1);
            stack.push(id);
            for (const next of outgoing.get(id) ?? []) {
                if (!nodes.has(next)) continue;
                if ((state.get(next) ?? 0) === 0) visit(next);
                else if (state.get(next) === 1) {
                    const start = stack.lastIndexOf(next);
                    for (const cycleId of stack.slice(start)) inCycle.add(cycleId);
                }
            }
            stack.pop();
            state.set(id, 2);
        };

        for (const id of nodes.keys()) {
            if ((state.get(id) ?? 0) === 0) visit(id);
        }
        return [...inCycle];
    }

    private walk(start: string, adjacency: ReadonlyMap<string, string[]>): Set<string> {
        const visited = new Set<string>();
        const pending = [start];
        while (pending.length > 0) {
            const current = pending.pop()!;
            if (visited.has(current)) continue;
            visited.add(current);
            pending.push(...(adjacency.get(current) ?? []));
        }
        return visited;
    }

    private calculateMaxDepth(start: string, outgoing: ReadonlyMap<string, string[]>): number {
        const memo = new Map<string, number>();
        const visit = (id: string): number => {
            const cached = memo.get(id);
            if (cached !== undefined) return cached;
            const children = outgoing.get(id) ?? [];
            const depth = children.length === 0 ? 0 : 1 + Math.max(...children.map(visit));
            memo.set(id, depth);
            return depth;
        };
        return visit(start);
    }

    private validateEntryBranchConvergence(
        entryId: string,
        nodes: ReadonlyMap<string, TTopologyGraphNode>,
        outgoing: ReadonlyMap<string, string[]>,
        addIssue: (issue: TTopologyIssue) => void,
    ): void {
        const branchRoots = outgoing.get(entryId) ?? [];
        if (branchRoots.length <= 1) return;

        const convergenceGroups = branchRoots.map((rootId) => {
            let currentId = rootId;
            const visited = new Set<string>();
            while (!visited.has(currentId)) {
                visited.add(currentId);
                const current = nodes.get(currentId);
                if (!current || current.kind !== 'PROXY') return null;
                const nextId = outgoing.get(currentId)?.[0];
                if (!nextId) return null;
                const next = nodes.get(nextId);
                if (next?.kind === 'LOAD_BALANCER') return next.id;
                if (next?.kind !== 'PROXY') return null;
                currentId = next.id;
            }
            return null;
        });
        const commonGroup = convergenceGroups[0];
        if (!commonGroup || convergenceGroups.some((groupId) => groupId !== commonGroup)) {
            addIssue({
                code: 'ENTRY_BRANCHES_DO_NOT_CONVERGE',
                message:
                    'Multiple entry branches must converge into the same load-balancing group.',
                nodeIds: [entryId, ...branchRoots],
            });
        }
    }

    private validatePhysicalServerPaths(
        start: string,
        nodes: ReadonlyMap<string, TTopologyGraphNode>,
        outgoing: ReadonlyMap<string, string[]>,
        addIssue: (issue: TTopologyIssue) => void,
    ): void {
        const visit = (id: string, physicalPath: ReadonlyMap<string, string>) => {
            const node = nodes.get(id);
            if (!node) return;
            let nextPath = physicalPath;
            if (node.kind === 'PROXY') {
                const previous = physicalPath.get(node.nodeUuid);
                if (previous) {
                    addIssue({
                        code: 'PHYSICAL_SERVER_LOOP',
                        message:
                            'A chain cannot return to a physical server already used on the same path.',
                        nodeIds: [previous, node.id],
                    });
                }
                nextPath = new Map(physicalPath).set(node.nodeUuid, node.id);
            }
            for (const child of outgoing.get(id) ?? []) visit(child, nextPath);
        };

        visit(start, new Map());
    }
}
