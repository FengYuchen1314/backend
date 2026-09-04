import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TTopologyGraph } from '@libs/contracts/models';

import { TopologyCompiler } from './topology.compiler';
import { TopologyRepository } from './topology.repository';
import { TopologyService } from './topology.service';
import { TopologyReferenceSnapshot } from './topology.types';
import { TopologyValidator } from './topology.validator';

const IDS = {
    entry: '00000000-0000-4000-8000-000000000001',
    exit: '00000000-0000-4000-8000-000000000002',
    lb: '00000000-0000-4000-8000-000000000003',
    a: '00000000-0000-4000-8000-000000000004',
    b: '00000000-0000-4000-8000-000000000005',
    c: '00000000-0000-4000-8000-000000000006',
    edge1: '10000000-0000-4000-8000-000000000001',
    edge2: '10000000-0000-4000-8000-000000000002',
    edge3: '10000000-0000-4000-8000-000000000003',
    edge4: '10000000-0000-4000-8000-000000000004',
    edge5: '10000000-0000-4000-8000-000000000005',
    edge6: '10000000-0000-4000-8000-000000000006',
    hostA: '20000000-0000-4000-8000-000000000001',
    hostB: '20000000-0000-4000-8000-000000000002',
    hostC: '20000000-0000-4000-8000-000000000003',
    nodeA: '30000000-0000-4000-8000-000000000001',
    nodeB: '30000000-0000-4000-8000-000000000002',
    nodeC: '30000000-0000-4000-8000-000000000003',
    topology: '40000000-0000-4000-8000-000000000001',
} as const;

function linearGraph(nodeC: string = IDS.nodeC): TTopologyGraph {
    return {
        schemaVersion: 1,
        nodes: [
            { id: IDS.entry, kind: 'ENTRY', label: 'Composite entry' },
            {
                id: IDS.a,
                kind: 'PROXY',
                label: 'Los Angeles',
                hostUuid: IDS.hostA,
                nodeUuid: IDS.nodeA,
            },
            {
                id: IDS.b,
                kind: 'PROXY',
                label: 'Tokyo',
                hostUuid: IDS.hostB,
                nodeUuid: IDS.nodeB,
            },
            {
                id: IDS.c,
                kind: 'PROXY',
                label: 'Frankfurt',
                hostUuid: IDS.hostC,
                nodeUuid: nodeC,
            },
            { id: IDS.exit, kind: 'EXIT', label: 'Internet' },
        ],
        edges: [
            { id: IDS.edge1, source: IDS.entry, target: IDS.a },
            { id: IDS.edge2, source: IDS.a, target: IDS.b },
            { id: IDS.edge3, source: IDS.b, target: IDS.c },
            { id: IDS.edge4, source: IDS.c, target: IDS.exit },
        ],
    };
}

function loadBalancedGraph(strategy: 'ROUND_ROBIN' | 'URL_TEST' = 'ROUND_ROBIN'): TTopologyGraph {
    return {
        schemaVersion: 1,
        nodes: [
            { id: IDS.entry, kind: 'ENTRY', label: 'Balanced entry' },
            {
                id: IDS.lb,
                kind: 'LOAD_BALANCER',
                label: 'Fastest ingress',
                strategy,
                testUrl:
                    strategy === 'URL_TEST' ? 'https://www.gstatic.com/generate_204' : undefined,
                intervalSeconds: strategy === 'URL_TEST' ? 120 : undefined,
            },
            {
                id: IDS.a,
                kind: 'PROXY',
                label: 'Los Angeles',
                hostUuid: IDS.hostA,
                nodeUuid: IDS.nodeA,
            },
            {
                id: IDS.b,
                kind: 'PROXY',
                label: 'Tokyo',
                hostUuid: IDS.hostB,
                nodeUuid: IDS.nodeB,
            },
            {
                id: IDS.c,
                kind: 'PROXY',
                label: 'Frankfurt',
                hostUuid: IDS.hostC,
                nodeUuid: IDS.nodeC,
            },
            { id: IDS.exit, kind: 'EXIT', label: 'Internet' },
        ],
        edges: [
            { id: IDS.edge1, source: IDS.entry, target: IDS.a, order: 0 },
            { id: IDS.edge2, source: IDS.entry, target: IDS.b, order: 1 },
            { id: IDS.edge3, source: IDS.a, target: IDS.lb },
            { id: IDS.edge4, source: IDS.b, target: IDS.lb },
            { id: IDS.edge5, source: IDS.lb, target: IDS.c },
            { id: IDS.edge6, source: IDS.c, target: IDS.exit },
        ],
    };
}

function references(graph: TTopologyGraph): TopologyReferenceSnapshot {
    const proxies = graph.nodes.filter((node) => node.kind === 'PROXY');
    return {
        nodeUuids: new Set(proxies.map((node) => node.nodeUuid)),
        hosts: new Map(
            proxies.map((node) => [
                node.hostUuid,
                {
                    nodeUuids: new Set([node.nodeUuid]),
                    activeInboundNodeUuids: new Set([node.nodeUuid]),
                },
            ]),
        ),
    };
}

function deepGraph(proxyCount: number): TTopologyGraph {
    const proxies = Array.from({ length: proxyCount }, (_, index) => {
        const suffix = String(index + 1).padStart(12, '0');
        return {
            id: `50000000-0000-4000-8000-${suffix}`,
            kind: 'PROXY' as const,
            label: `Proxy ${index + 1}`,
            hostUuid: `51000000-0000-4000-8000-${suffix}`,
            nodeUuid: `52000000-0000-4000-8000-${suffix}`,
        };
    });
    const path = [IDS.entry, ...proxies.map((proxy) => proxy.id), IDS.exit];
    return {
        schemaVersion: 1,
        nodes: [
            { id: IDS.entry, kind: 'ENTRY', label: 'Deep entry' },
            ...proxies,
            { id: IDS.exit, kind: 'EXIT', label: 'Deep exit' },
        ],
        edges: path.slice(0, -1).map((source, index) => ({
            id: `53000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
            source,
            target: path[index + 1]!,
        })),
    };
}

describe('TopologyValidator', () => {
    const validator = new TopologyValidator();

    it('accepts a cross-server DAG', () => {
        const graph = linearGraph();
        const result = validator.validate(graph, references(graph));
        assert.equal(result.valid, true);
        assert.equal(result.maxDepth, 4);
    });

    it('accepts many-to-one load-balanced branches', () => {
        const graph = loadBalancedGraph();
        const result = validator.validate(graph, references(graph));
        assert.equal(result.valid, true);
        assert.equal(result.maxDepth, 4);
    });

    it('rejects a load balancer with fewer than two incoming members', () => {
        const graph = loadBalancedGraph();
        graph.edges = graph.edges.filter((edge) => edge.id !== IDS.edge2 && edge.id !== IDS.edge4);
        const result = validator.validate(graph, references(graph));
        assert.ok(result.issues.some((issue) => issue.code === 'EMPTY_LOAD_BALANCER'));
    });

    it('rejects a chain returning to the same physical server', () => {
        const graph = linearGraph(IDS.nodeA);
        const result = validator.validate(graph, references(graph));
        assert.equal(result.valid, false);
        assert.ok(result.issues.some((issue) => issue.code === 'PHYSICAL_SERVER_LOOP'));
    });

    it('rejects directed cycles', () => {
        const graph = linearGraph();
        graph.edges[2] = { id: IDS.edge3, source: IDS.b, target: IDS.a };
        const result = validator.validate(graph, references(graph));
        assert.ok(result.issues.some((issue) => issue.code === 'DIRECTED_CYCLE'));
    });

    it('rejects duplicate directed edges', () => {
        const graph = linearGraph();
        graph.edges.push({ id: IDS.edge5, source: IDS.a, target: IDS.b });
        const result = validator.validate(graph, references(graph));
        assert.ok(result.issues.some((issue) => issue.code === 'DUPLICATE_EDGE'));
    });

    it('rejects host and physical-node ownership mismatches', () => {
        const graph = linearGraph();
        const snapshot = references(graph);
        const host = snapshot.hosts.get(IDS.hostA)!;
        const mismatched: TopologyReferenceSnapshot = {
            ...snapshot,
            hosts: new Map(snapshot.hosts).set(IDS.hostA, {
                ...host,
                nodeUuids: new Set([IDS.nodeB]),
            }),
        };
        const result = validator.validate(graph, mismatched);
        assert.ok(result.issues.some((issue) => issue.code === 'HOST_NODE_MISMATCH'));
    });

    it('rejects graphs deeper than the configured chain limit', () => {
        const graph = deepGraph(17);
        const result = validator.validate(graph, references(graph));
        assert.ok(result.issues.some((issue) => issue.code === 'MAX_DEPTH_EXCEEDED'));
    });
});

describe('TopologyCompiler', () => {
    const compiler = new TopologyCompiler();

    it('compiles Mihomo dialer-proxy and a many-to-one load-balance group', () => {
        const result = compiler.compile(loadBalancedGraph(), 'MIHOMO');
        assert.equal(result.status, 'SUPPORTED');
        if (result.status !== 'SUPPORTED') return;

        const groups = result.artifact['proxy-groups'] as Array<Record<string, unknown>>;
        const entry = groups.find((group) => group.name === 'Balanced entry')!;
        assert.deepEqual(entry.proxies, ['Fastest ingress']);
        const loadBalancer = groups.find((group) => group.name === 'Fastest ingress')!;
        assert.deepEqual(loadBalancer.proxies, ['Los Angeles', 'Tokyo']);
        assert.equal(loadBalancer.type, 'load-balance');

        const patches = result.artifact.proxyPatches as Array<Record<string, unknown>>;
        assert.equal(patches.length, 2);
        assert.ok(
            patches.every(
                (patch) => (patch.set as Record<string, unknown>)['dialer-proxy'] === 'Frankfurt',
            ),
        );
    });

    it('compiles sing-box detours and urltest groups', () => {
        const result = compiler.compile(loadBalancedGraph('URL_TEST'), 'SINGBOX');
        assert.equal(result.status, 'SUPPORTED');
        if (result.status !== 'SUPPORTED') return;

        const outbounds = result.artifact.outbounds as Array<Record<string, unknown>>;
        const urltest = outbounds.find((outbound) => outbound.tag === 'Fastest ingress')!;
        assert.equal(urltest.type, 'urltest');
        assert.deepEqual(urltest.outbounds, ['Los Angeles', 'Tokyo']);
        const patches = result.artifact.outboundPatches as Array<Record<string, unknown>>;
        assert.ok(
            patches.every((patch) => (patch.set as Record<string, unknown>).detour === 'Frankfurt'),
        );
    });

    it('returns structured unsupported results instead of degrading formats', () => {
        assert.equal(compiler.compile(loadBalancedGraph(), 'SINGBOX').status, 'UNSUPPORTED');
        const xray = compiler.compile(linearGraph(), 'XRAY_JSON');
        const base64 = compiler.compile(linearGraph(), 'XRAY_BASE64');
        assert.equal(xray.status, 'UNSUPPORTED');
        assert.equal(base64.status, 'UNSUPPORTED');
        if (base64.status === 'UNSUPPORTED') {
            assert.equal(base64.reasonCode, 'BASE64_CANNOT_REPRESENT_TOPOLOGY');
        }
    });
});

describe('TopologyService optimistic locking', () => {
    it('reports a version conflict when a concurrent writer wins', async () => {
        const graph = linearGraph();
        const repository = {
            findByUuid: async () => ({
                uuid: IDS.topology,
                name: 'Chain',
                version: 1,
                graph,
                createdAt: new Date(0).toISOString(),
                updatedAt: new Date(0).toISOString(),
            }),
            nameExists: async () => false,
            updateIfVersion: async () => null,
        } as unknown as TopologyRepository;
        const service = new TopologyService(
            repository,
            new TopologyValidator(),
            new TopologyCompiler(),
        );

        const result = await service.update(IDS.topology, 1, 'Updated chain');
        assert.equal(result.isOk, false);
        if (!result.isOk) assert.equal(result.code, 'XT003');
    });
});
