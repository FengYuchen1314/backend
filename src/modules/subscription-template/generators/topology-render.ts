import type { ResolvedProxyConfig } from '../resolve-proxy/interfaces';

import type { BoundSubscriptionTopology } from '@modules/topologies/topology-subscription.service';
import { TopologyCompiler } from '@modules/topologies/topology.compiler';

type Config = Record<string, unknown>;
export interface TopologyInjection {
    entries: string[];
    proxies: Config[];
    groups: Config[];
}

// Native clients address objects by name, not Host UUID. Allocate a private namespace
// and clone every occurrence, so ordinary hosts and separate graphs remain independent.
export function renderTopologies(
    bound: readonly BoundSubscriptionTopology[],
    format: 'MIHOMO' | 'SINGBOX',
    reservedNames: Iterable<string>,
    renderHost: (host: ResolvedProxyConfig) => Config | null,
): TopologyInjection {
    const names = new Set(reservedNames);
    const compiler = new TopologyCompiler();
    const result: TopologyInjection = { entries: [], proxies: [], groups: [] };
    for (const { topology, hosts } of bound) {
        const graph = structuredClone(topology.graph);
        for (const node of graph.nodes) {
            const base =
                node.kind === 'ENTRY'
                    ? `${topology.name} [${topology.uuid}]`
                    : `rw:${topology.uuid}:${node.id}`;
            let name = base;
            for (let index = 1; names.has(name); index++) name = `${base}:${index}`;
            names.add(name);
            node.label = name;
        }
        const compiled = compiler.compile(graph, format);
        if (compiled.status !== 'SUPPORTED') continue;
        const proxyNodes = graph.nodes.filter((node) => node.kind === 'PROXY');
        const proxies: Config[] = [];
        const byId = new Map<string, Config>();
        for (const node of proxyNodes) {
            const host = hosts.get(node.id);
            if (!host || host.metadata.excludeFromSubscriptionTypes.includes(format)) break;
            const proxy = renderHost(structuredClone(host));
            if (!proxy) break;
            // The graph, not a generic host mapper, owns these transport dependencies.
            delete proxy['dialer-proxy'];
            delete proxy.detour;
            proxy[format === 'MIHOMO' ? 'name' : 'tag'] = node.label;
            proxies.push(proxy);
            byId.set(node.id, proxy);
        }
        if (proxies.length !== proxyNodes.length) continue;
        const artifact = compiled.artifact;
        const patches = artifact[
            format === 'MIHOMO' ? 'proxyPatches' : 'outboundPatches'
        ] as Array<{ graphNodeId: string; set: Config }>;
        for (const patch of patches) Object.assign(byId.get(patch.graphNodeId)!, patch.set);
        const groups = artifact[format === 'MIHOMO' ? 'proxy-groups' : 'outbounds'] as Config[];
        result.entries.push(artifact.entryTag as string);
        result.proxies.push(...proxies);
        result.groups.push(...groups.map(({ xboard: _metadata, ...group }) => group));
    }
    return result;
}
