import { load } from 'js-yaml';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { UpdateTopologyCommand } from '@libs/contracts/commands/topologies';

import { TopologySubscriptionService } from '@modules/topologies/topology-subscription.service';
import { TopologyCompiler } from '@modules/topologies/topology.compiler';
import { TopologyRepository } from '@modules/topologies/topology.repository';
import { TopologyService } from '@modules/topologies/topology.service';
import { TopologyReferenceSnapshot } from '@modules/topologies/topology.types';
import { TopologyValidator } from '@modules/topologies/topology.validator';

import { RenderTemplatesService } from '../render-templates.service';
import { MihomoGeneratorService } from './mihomo.generator.service';
import { SingBoxGeneratorService } from './singbox.generator.service';
import { id, proxy, bound } from './topology-test-fixtures';
const templates = {
    async getCachedTemplateByType(type: string) {
        return type === 'MIHOMO'
            ? {
                  proxies: [],
                  'proxy-groups': [{ name: 'Main', type: 'select', proxies: [] }],
                  rules: ['MATCH,Main'],
              }
            : { outbounds: [{ tag: 'Main', type: 'selector' }], route: { final: 'Main' } };
    },
};

test('published topology uses only authorized Host credentials and current physical-node bindings', async () => {
    const item = bound();
    let enabledOnly: boolean | undefined;
    const snapshot: TopologyReferenceSnapshot = {
        nodeUuids: new Set([id(401), id(402)]),
        hosts: new Map(
            [1, 2].map((n) => [
                id(100 + n),
                {
                    nodeUuids: new Set([id(400 + n)]),
                    activeInboundNodeUuids: new Set([id(400 + n)]),
                },
            ]),
        ),
    };
    const repository = {
        findAll: async () => [item.topology],
        getReferenceSnapshot: async (_graph: unknown, enabled: boolean) => {
            enabledOnly = enabled;
            return snapshot;
        },
    } as unknown as TopologyRepository;
    const service = new TopologySubscriptionService(repository, new TopologyValidator());
    assert.equal((await service.resolve([proxy(1), proxy(2)])).length, 1);
    assert.equal(enabledOnly, true);
    (snapshot.hosts.get(id(101))!.nodeUuids as Set<string>).add(id(403));
    assert.deepEqual(await service.resolve([proxy(1), proxy(2)]), []);
    (snapshot.hosts.get(id(101))!.nodeUuids as Set<string>).delete(id(403));
    assert.deepEqual(await service.resolve([proxy(1)]), []);
    item.topology.isPublished = false;
    assert.deepEqual(await service.resolve([proxy(1), proxy(2)]), []);
    item.topology.isPublished = true;
    (snapshot.hosts as Map<string, unknown>).delete(id(101));
    assert.deepEqual(await service.resolve([proxy(1), proxy(2)]), []);
});

test('publication updates are explicit, revision-locked and retained when editing a published graph', async () => {
    const item = bound();
    item.topology.isPublished = false;
    const writes: unknown[][] = [];
    const repository = {
        findByUuid: async () => item.topology,
        nameExists: async () => false,
        getReferenceSnapshot: async () => ({
            nodeUuids: new Set([id(401), id(402)]),
            hosts: new Map(
                [1, 2].map((n) => [
                    id(100 + n),
                    {
                        nodeUuids: new Set([id(400 + n)]),
                        activeInboundNodeUuids: new Set([id(400 + n)]),
                    },
                ]),
            ),
        }),
        updateIfVersion: async (...args: unknown[]) => {
            writes.push(args);
            item.topology.isPublished = args[4] as boolean;
            item.topology.version++;
            return item.topology;
        },
    } as unknown as TopologyRepository;
    const service = new TopologyService(
        repository,
        new TopologyValidator(),
        new TopologyCompiler(),
    );
    assert.ok(
        UpdateTopologyCommand.RequestBodySchema.safeParse({ expectedVersion: 1, isPublished: true })
            .success,
    );
    assert.ok(!UpdateTopologyCommand.RequestBodySchema.safeParse({ expectedVersion: 1 }).success);
    assert.ok((await service.update(item.topology.uuid, 1, undefined, undefined, true)).isOk);
    assert.equal(writes[0][4], true);
    assert.equal(
        (await service.update(item.topology.uuid, 1, undefined, undefined, false)).isOk,
        false,
    );
    assert.equal(writes.length, 1);
    assert.ok((await service.update(item.topology.uuid, 2, 'Renamed')).isOk);
    assert.equal(writes[1][4], true);
    assert.ok((await service.update(item.topology.uuid, 3, undefined, undefined, false)).isOk);
    assert.equal(writes[2][4], false);
});

test('an unreadable optional topology omits composites without failing the ordinary subscription', async () => {
    const service = new TopologySubscriptionService(
        {
            findAll: async () => {
                throw new Error('simulated unavailable topology store');
            },
        } as never,
        new TopologyValidator(),
    );
    assert.deepEqual(await service.resolve([proxy(1)]), []);
});

test('normal subscription entry point includes published topologies only for active supported clients', async () => {
    let resolutions = 0;
    const hosts = [proxy(1), proxy(2)];
    const resolver = {
        resolve: async (authorized: unknown) => {
            assert.equal(authorized, hosts);
            resolutions++;
            return [bound()];
        },
    };
    const service = new RenderTemplatesService(
        { resolveProxyConfig: async () => hosts } as never,
        new MihomoGeneratorService(templates as never),
        { generateConfig: async () => 'legacy-clash' } as never,
        { generateConfig: async () => 'legacy-base64' } as never,
        new SingBoxGeneratorService(templates as never),
        { generateConfig: async () => 'legacy-xray-json' } as never,
        resolver as never,
    );
    const subscription = async (status: string, matchedResponseType: string) =>
        service.generateSubscription({
            user: { status },
            srrContext: { matchedResponseType },
            hosts: [],
        } as never);
    for (const format of ['MIHOMO', 'SINGBOX']) {
        assert.match((await subscription('ACTIVE', format)).subscription, /Published chain/);
        assert.doesNotMatch(
            (await subscription('DISABLED', format)).subscription,
            /Published chain/,
        );
    }
    for (const format of ['CLASH', 'XRAY_BASE64', 'XRAY_JSON']) {
        assert.match((await subscription('ACTIVE', format)).subscription, /legacy-/);
    }
    assert.equal(resolutions, 2);
});

test('Mihomo subscription adds a selectable composite with correct hop order without mutating ordinary nodes', async () => {
    const item = bound();
    const original = [proxy(1), proxy(2)];
    const before = structuredClone(original);
    const text = await new MihomoGeneratorService(templates as never).generateConfig(
        original,
        false,
        false,
        undefined,
        [item],
    );
    const config = load(text) as any;
    assert.deepEqual(original, before);
    assert.equal(config.proxies.length, 4);
    const clones = config.proxies.slice(2);
    assert.equal(clones[0]['dialer-proxy'], undefined);
    assert.equal(clones[1]['dialer-proxy'], clones[0].name);
    assert.equal(clones[1].password, 'private-2');
    assert.equal(config.proxies[1]['dialer-proxy'], undefined);
    const entry = config['proxy-groups'].find((group: any) =>
        group.name.startsWith('Published chain'),
    );
    assert.deepEqual(entry.proxies, [clones[1].name]);
    assert.ok(config['proxy-groups'][0].proxies.includes(entry.name));
    assert.equal(entry.xboard, undefined);
    assert.ok(!config['proxy-groups'][0].proxies.includes(clones[0].name));
});

test('Mihomo preserves many-to-one load balancing and namespaces two graphs using the same hosts', async () => {
    const first = bound(true);
    const second = structuredClone(first);
    second.topology.uuid = id(998);
    const config = load(
        await new MihomoGeneratorService(templates as never).generateConfig(
            [proxy(1), proxy(2), proxy(3)],
            false,
            false,
            undefined,
            [first, second],
        ),
    ) as any;
    const groups = config['proxy-groups'];
    const balances = groups.filter((group: any) => group.type === 'load-balance');
    assert.equal(balances.length, 2);
    for (const group of balances) {
        assert.equal(group.strategy, 'round-robin');
        assert.equal(group.proxies.length, 2);
        const terminal = config.proxies.find((node: any) => node['dialer-proxy'] === group.name);
        assert.equal(terminal.username, 'user-3');
    }
    const names = [
        ...config.proxies.map((node: any) => node.name),
        ...groups.map((group: any) => group.name),
    ];
    assert.equal(new Set(names).size, names.length);
});

test('sing-box includes complete detour chains while excluding only unsupported composite formats', async () => {
    const linear = bound();
    const config = JSON.parse(
        await new SingBoxGeneratorService(templates as never).generateConfig(
            [proxy(1), proxy(2)],
            undefined,
            [linear, bound(true)],
        ),
    );
    const clones = config.outbounds.filter((outbound: any) => outbound.tag.startsWith('rw:'));
    assert.equal(clones.length, 2);
    assert.equal(clones[1].detour, clones[0].tag);
    assert.equal(clones[0].detour, undefined);
    const entry = config.outbounds.find((outbound: any) =>
        outbound.tag.startsWith('Published chain'),
    );
    assert.deepEqual(entry.outbounds, [clones[1].tag]);
    assert.ok(config.outbounds[0].outbounds.includes(entry.tag));
    assert.ok(!config.outbounds[0].outbounds.includes(clones[0].tag));
    assert.equal(entry.xboard, undefined);
});

test('a client-excluded or unsupported member omits the entire composite, never a truncated chain', async () => {
    const item = bound();
    item.hosts.get(id(2))!.metadata.excludeFromSubscriptionTypes = ['MIHOMO'];
    const config = load(
        await new MihomoGeneratorService(templates as never).generateConfig(
            [proxy(1)],
            false,
            false,
            undefined,
            [item],
        ),
    ) as any;
    assert.equal(config.proxies.length, 1);
    assert.equal(config['proxy-groups'].length, 1);
});
