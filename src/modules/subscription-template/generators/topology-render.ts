import type { ResolvedProxyConfig } from '../resolve-proxy/interfaces';

import type { BoundSubscriptionTopology } from '@modules/topologies/topology-subscription.service';
import { TopologyCompiler } from '@modules/topologies/topology.compiler';

type Config = Record<string, unknown>;
export type AllocateProxyName = (base: string) => string;
export interface RenderedHostProxies<T extends Config = Config> {
    entry: T;
    transport: T;
    proxies: T[];
    privateNames: string[];
}

export function singleHostProxy<T extends Config>(proxy: T): RenderedHostProxies<T> {
    return { entry: proxy, transport: proxy, proxies: [proxy], privateNames: [] };
}

export function proxyNameAllocator(names: Set<string>): AllocateProxyName {
    return (base) => {
        let name = base;
        for (let index = 1; names.has(name); index++) name = `${base}:${index}`;
        names.add(name);
        return name;
    };
}

export interface TopologyInjection {
    entries: string[];
    proxies: Config[];
    groups: Config[];
    privateNames: string[];
}

// Native clients address objects by name, not Host UUID. Allocate a private namespace
// and clone every occurrence, so ordinary hosts and separate graphs remain independent.
export function renderTopologies(
    bound: readonly BoundSubscriptionTopology[],
    format: 'MIHOMO' | 'SINGBOX',
    reservedNames: Iterable<string>,
    renderHost: (
        host: ResolvedProxyConfig,
        label: string,
        allocateName: AllocateProxyName,
    ) => RenderedHostProxies | null,
): TopologyInjection {
    const names = new Set(reservedNames);
    const allocateName = proxyNameAllocator(names);
    const compiler = new TopologyCompiler();
    const result: TopologyInjection = { entries: [], proxies: [], groups: [], privateNames: [] };
    for (const { topology, hosts } of bound) {
        const graph = structuredClone(topology.graph);
        for (const node of graph.nodes) {
            const base =
                node.kind === 'ENTRY'
                    ? `${topology.name} [${topology.uuid}]`
                    : `rw:${topology.uuid}:${node.id}`;
            node.label = allocateName(base);
        }
        const compiled = compiler.compile(graph, format);
        if (compiled.status !== 'SUPPORTED') continue;
        const proxyNodes = graph.nodes.filter((node) => node.kind === 'PROXY');
        const proxies: Config[] = [];
        const privateNames: string[] = [];
        const byId = new Map<string, Config>();
        for (const node of proxyNodes) {
            const host = hosts.get(node.id);
            if (!host || host.metadata.excludeFromSubscriptionTypes.includes(format)) break;
            const bundle = renderHost(structuredClone(host), node.label, allocateName);
            if (!bundle) break;
            // Graph dependencies attach to the network-facing transport. An encrypted
            // logical node may have mandatory inner dependencies that must stay intact.
            delete bundle.transport['dialer-proxy'];
            delete bundle.transport.detour;
            bundle.entry[format === 'MIHOMO' ? 'name' : 'tag'] = node.label;
            proxies.push(...bundle.proxies);
            privateNames.push(...bundle.privateNames);
            byId.set(node.id, bundle.transport);
        }
        if (byId.size !== proxyNodes.length) continue;
        const artifact = compiled.artifact;
        const patches = artifact[
            format === 'MIHOMO' ? 'proxyPatches' : 'outboundPatches'
        ] as Array<{ graphNodeId: string; set: Config }>;
        for (const patch of patches) Object.assign(byId.get(patch.graphNodeId)!, patch.set);
        const groups = artifact[format === 'MIHOMO' ? 'proxy-groups' : 'outbounds'] as Config[];
        result.entries.push(artifact.entryTag as string);
        result.proxies.push(...proxies);
        result.groups.push(...groups.map(({ xboard: _metadata, ...group }) => group));
        result.privateNames.push(...privateNames);
    }
    return result;
}
