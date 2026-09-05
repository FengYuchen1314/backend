import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { NodesRepository } from '../repositories/nodes.repository';
import { AddUserToNodeEvent } from './add-user-to-node';
import { AddUserToNodeHandler } from './add-user-to-node/add-user-to-node.handler';
import { AddUsersToNodeEvent } from './add-users-to-node';
import { AddUsersToNodeHandler } from './add-users-to-node/add-users-to-node.handler';
import { RemoveUserFromNodeEvent } from './remove-user-from-node';
import { RemoveUserFromNodeHandler } from './remove-user-from-node/remove-user-from-node.handler';
import { RemoveUsersFromNodeEvent } from './remove-users-from-node';
import { RemoveUsersFromNodeHandler } from './remove-users-from-node/remove-users-from-node.handler';

const socksInbound = { tag: 'SOCKS', type: 'socks', rawInbound: null };
const mieruInbound = { tag: 'MIERU', type: 'mieru', rawInbound: null };
const vlessInbound = { tag: 'VLESS', type: 'vless', rawInbound: null };
const anyTlsInbound = { tag: 'ANYTLS', type: 'anytls', rawInbound: null };

test('managed user sync includes connecting nodes while legacy hot-update nodes remain excluded when busy', async () => {
    let where: unknown;
    const rows = [
        {
            uuid: 'public-starting',
            serverType: 'PUBLIC_DIRECT',
            isConnecting: true,
            configProfileInboundsToNodes: [],
        },
        {
            uuid: 'anytls-starting',
            isConnecting: true,
            configProfileInboundsToNodes: [{ configProfileInbounds: anyTlsInbound }],
        },
        {
            uuid: 'legacy-busy',
            isConnecting: true,
            configProfileInboundsToNodes: [{ configProfileInbounds: vlessInbound }],
        },
        {
            uuid: 'legacy-ready',
            isConnecting: false,
            configProfileInboundsToNodes: [{ configProfileInbounds: vlessInbound }],
        },
    ];
    const repository = new NodesRepository(
        {
            tx: {
                nodes: {
                    async findMany(input: { where: unknown }) {
                        where = input.where;
                        return rows;
                    },
                },
            },
        } as never,
        {} as never,
        {} as never,
    );
    assert.deepEqual(
        (await repository.findConnectedNodes()).map((node) => node.uuid),
        ['public-starting', 'anytls-starting', 'legacy-ready'],
    );
    assert.deepEqual((where as { OR: unknown }).OR, [
        { isConnected: true },
        { isConnecting: true },
    ]);
    assert.equal(Object.hasOwn(where as object, 'isConnecting'), false);
});

const buildNode = (uuid: string, activeInbounds: object[]) => ({
    uuid,
    address: `${uuid}.example.com`,
    port: 2_222,
    proxyUrl: null,
    activeConfigProfileUuid: 'profile-uuid',
    activeInbounds,
});

const user = {
    id: 42n,
    trojanPassword: 'trojan-password',
    vlessUuid: '56f01999-2f72-4e8b-a81e-5298e618ba39',
    ssPassword: 'ss-password',
    inbounds: [socksInbound, vlessInbound],
};

test('AnyTLS users and empty entitlements trigger complete reloads on public-direct nodes for all event types', async () => {
    for (const inbounds of [[anyTlsInbound, mieruInbound], []]) {
        const starts: unknown[] = [];
        const nodes = [
            buildNode('anytls-node', [anyTlsInbound]),
            {
                ...buildNode('joint-vless-node', [vlessInbound]),
                serverType: 'PUBLIC_DIRECT',
                isConnecting: true,
            },
        ];
        const queues = {
            async startNode(data: unknown) {
                starts.push(data);
            },
        };
        const repository = {
            async findConnectedNodes() {
                return nodes;
            },
            async findConnectedNodesWithInboundsForRemoval() {
                return nodes;
            },
        };
        const current = { ...user, inbounds };
        await new AddUserToNodeHandler(
            repository as never,
            queues as never,
            {
                async execute() {
                    return { isOk: true, response: current };
                },
            } as never,
        ).handle(new AddUserToNodeEvent(user.id));
        await new AddUsersToNodeHandler(
            repository as never,
            queues as never,
            {
                async execute() {
                    return { isOk: true, response: [current] };
                },
            } as never,
        ).handle(new AddUsersToNodeEvent([user.id]));
        await new RemoveUserFromNodeHandler(repository as never, queues as never).handle(
            new RemoveUserFromNodeEvent(user.id, user.vlessUuid),
        );
        await new RemoveUsersFromNodeHandler(repository as never, queues as never).handle(
            new RemoveUsersFromNodeEvent([user]),
        );
        assert.deepEqual(
            starts,
            Array.from({ length: 4 }, () => [
                { nodeUuid: 'anytls-node', force: true, retryIfBusy: true },
                { nodeUuid: 'joint-vless-node', force: true, retryIfBusy: true },
            ]).flat(),
        );
    }
});

test('single-user add reloads SOCKS and Mieru nodes and preserves Xray hot updates', async () => {
    const starts: unknown[] = [];
    const adds: unknown[] = [];
    const removes: unknown[] = [];
    const queues = {
        async startNode(payload: unknown) {
            starts.push(payload);
        },
        async addUserToNode(payload: unknown) {
            adds.push(payload);
        },
        async removeUserFromNode(payload: unknown) {
            removes.push(payload);
        },
    };
    const repository = {
        async findConnectedNodes() {
            return [
                buildNode('socks-node', [socksInbound]),
                buildNode('mieru-node', [mieruInbound]),
                buildNode('vless-node', [vlessInbound]),
            ];
        },
    };
    const queryBus = {
        async execute() {
            return { isOk: true, response: user };
        },
    };

    const handler = new AddUserToNodeHandler(
        repository as never,
        queues as never,
        queryBus as never,
    );
    await handler.handle(new AddUserToNodeEvent(user.id));

    assert.deepEqual(starts, [
        { nodeUuid: 'socks-node', force: true, retryIfBusy: true },
        { nodeUuid: 'mieru-node', force: true, retryIfBusy: true },
    ]);
    assert.equal(adds.length, 1);
    assert.deepEqual(
        (adds[0] as { data: { data: Array<{ tag: string }> } }).data.data.map((item) => item.tag),
        ['VLESS'],
    );
    assert.equal(removes.length, 0);
});

test('bulk add coalesces SOCKS and Mieru changes into one forced reload per node', async () => {
    const starts: unknown[] = [];
    const bulkAdds: unknown[] = [];
    const queues = {
        async startNode(payload: unknown) {
            starts.push(payload);
        },
        async addUsersToNode(payload: unknown) {
            bulkAdds.push(payload);
        },
        async removeUsersFromNode() {},
    };
    const repository = {
        async findConnectedNodes() {
            return [
                buildNode('socks-node', [socksInbound]),
                buildNode('mieru-node', [mieruInbound]),
                buildNode('vless-node', [vlessInbound]),
            ];
        },
    };
    const queryBus = {
        async execute() {
            return { isOk: true, response: [user] };
        },
    };

    const handler = new AddUsersToNodeHandler(
        repository as never,
        queues as never,
        queryBus as never,
    );
    await handler.handle(new AddUsersToNodeEvent([user.id]));

    assert.deepEqual(starts, [
        { nodeUuid: 'socks-node', force: true, retryIfBusy: true },
        { nodeUuid: 'mieru-node', force: true, retryIfBusy: true },
    ]);
    assert.equal(bulkAdds.length, 1);
});

test('single and bulk removal never call Xray user handlers for SOCKS or Mieru nodes', async () => {
    const starts: unknown[] = [];
    const singleRemovals: unknown[] = [];
    const bulkRemovals: unknown[] = [];
    const nodes = [
        buildNode('socks-node', [socksInbound]),
        buildNode('mieru-node', [mieruInbound]),
        buildNode('vless-node', [vlessInbound]),
    ];
    const repository = {
        async findConnectedNodesWithInboundsForRemoval() {
            return nodes;
        },
    };
    const queues = {
        async startNode(payload: unknown) {
            starts.push(payload);
        },
        async removeUserFromNodeBulk(payload: unknown) {
            singleRemovals.push(payload);
        },
        async removeUsersFromNode(payload: unknown) {
            bulkRemovals.push(payload);
        },
    };

    await new RemoveUserFromNodeHandler(repository as never, queues as never).handle(
        new RemoveUserFromNodeEvent(user.id, user.vlessUuid),
    );
    await new RemoveUsersFromNodeHandler(repository as never, queues as never).handle(
        new RemoveUsersFromNodeEvent([{ id: user.id, vlessUuid: user.vlessUuid }]),
    );

    assert.deepEqual(starts, [
        { nodeUuid: 'socks-node', force: true, retryIfBusy: true },
        { nodeUuid: 'mieru-node', force: true, retryIfBusy: true },
        { nodeUuid: 'socks-node', force: true, retryIfBusy: true },
        { nodeUuid: 'mieru-node', force: true, retryIfBusy: true },
    ]);
    assert.equal(singleRemovals.length, 1);
    assert.equal((singleRemovals[0] as unknown[]).length, 1);
    assert.equal(bulkRemovals.length, 1);
    assert.equal(
        (bulkRemovals[0] as { node: { address: string } }).node.address,
        'vless-node.example.com',
    );
});
