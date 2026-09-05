import 'reflect-metadata';
import { CreateNodeCommand } from '@contract/commands';
import { ERRORS, NODE_CREATION_MODES, SERVER_TYPES } from '@contract/constants';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ConfigProfileInboundEntity } from '@modules/config-profiles/entities';

import {
    getManagedNodeProtocol,
    validateManagedNodeCreation,
} from './managed-node-creation-policy';
import { NodesService } from './nodes.service';

const buildInbound = (
    data: Partial<ConfigProfileInboundEntity> &
        Pick<ConfigProfileInboundEntity, 'rawInbound' | 'type'>,
) =>
    new ConfigProfileInboundEntity({
        uuid: '1253df12-42fd-4f87-9d11-d21811ce2241',
        profileUuid: 'ff294d9d-be14-4610-ae9d-701e4c307dd0',
        tag: 'MANAGED',
        network: null,
        security: null,
        port: 443,
        ...data,
    });

const socksInbound = buildInbound({
    type: 'socks',
    port: 10_800,
    rawInbound: {
        protocol: 'socks',
        settings: { auth: 'password', users: [], udp: false },
    },
});

const visionInbound = buildInbound({
    type: 'vless',
    network: 'raw',
    security: 'reality',
    rawInbound: {
        protocol: 'vless',
        settings: { flow: 'xtls-rprx-vision', clients: [] },
        streamSettings: { network: 'raw', security: 'reality' },
    },
});

const xhttpInbound = buildInbound({
    type: 'vless',
    network: 'xhttp',
    security: 'reality',
    rawInbound: {
        protocol: 'vless',
        settings: { clients: [] },
        streamSettings: {
            network: 'xhttp',
            security: 'reality',
            xhttpSettings: { extra: { xmux: { maxConcurrency: '16-32' } } },
        },
    },
});

const mieruInbound = buildInbound({
    type: 'mieru',
    network: 'tcp',
    port: 24_443,
    rawInbound: {
        protocol: 'mieru',
        settings: {
            transport: 'TCP',
            port: 24_443,
            mtu: 1_400,
            multiplexing: 'MULTIPLEXING_LOW',
            handshakeMode: 'HANDSHAKE_STANDARD',
        },
    },
});

const anyTlsInbound = buildInbound({
    type: 'anytls',
    network: 'tcp',
    security: 'tls',
    rawInbound: {
        protocol: 'anytls',
        tag: 'MANAGED',
        settings: {
            tag: 'MANAGED',
            wrapperPort: 14443,
            innerPort: 16001,
            camouflage: { serverName: 'fixture.example.com', address: '192.0.2.50', port: 443 },
        },
    },
});

test('managed AnyTLS admits only the encrypted profile extension on public-direct servers', () => {
    assert.equal(getManagedNodeProtocol(anyTlsInbound), 'ANYTLS_SHADOWTLS');
    assert.equal(validateManagedNodeCreation(SERVER_TYPES.PUBLIC_DIRECT, [anyTlsInbound]), null);
    for (const serverType of [SERVER_TYPES.BROADBAND_LANDING, SERVER_TYPES.LEASED_LINE]) {
        assert.match(validateManagedNodeCreation(serverType, [anyTlsInbound]) ?? '', /not allowed/);
    }
    for (const settingsPatch of [
        { wrapperPort: 443 },
        { innerPort: 14443 },
        { tag: 'OTHER' },
        { camouflage: { serverName: 'fixture.pages.dev', address: '192.0.2.50', port: 443 } },
        { camouflage: { serverName: 'fixture.example.com', address: '104.16.1.1', port: 443 } },
        { tls: { insecure: true } },
        { users: [{ name: 'static-user', password: 'static-password' }] },
    ]) {
        const malformed = structuredClone(anyTlsInbound);
        const raw = malformed.rawInbound as { settings: Record<string, unknown> };
        Object.assign(raw.settings, settingsPatch);
        assert.equal(getManagedNodeProtocol(malformed), null);
    }
    for (const patch of [{ port: 14443 }, { security: null }, { network: 'udp' }]) {
        assert.equal(getManagedNodeProtocol({ ...anyTlsInbound, ...patch }), null);
    }
});

test('managed presets are classified without treating imported raw protocols as managed', () => {
    assert.equal(getManagedNodeProtocol(socksInbound), 'SOCKS5');
    assert.equal(getManagedNodeProtocol(visionInbound), 'VLESS_REALITY_VISION');
    assert.equal(getManagedNodeProtocol(xhttpInbound), 'VLESS_XHTTP_REALITY_XMUX');
    assert.equal(getManagedNodeProtocol(mieruInbound), 'MIERU_TCP');
    assert.equal(
        getManagedNodeProtocol(
            buildInbound({
                type: 'socks',
                rawInbound: {
                    protocol: 'socks',
                    settings: { auth: 'password', users: [], udp: true },
                },
            }),
        ),
        null,
    );
    assert.equal(
        getManagedNodeProtocol(
            buildInbound({
                type: 'socks',
                rawInbound: {
                    protocol: 'socks',
                    settings: { auth: 'password', users: [] },
                },
            }),
        ),
        null,
    );
    assert.equal(
        getManagedNodeProtocol(
            buildInbound({
                type: 'trojan',
                rawInbound: { protocol: 'trojan', settings: { clients: [] } },
            }),
        ),
        null,
    );
});

test('create-node contract defaults to managed mode and requires unique active inbounds', () => {
    const baseBody = {
        name: 'contract-node',
        address: 'contract-node.example.com',
        configProfile: {
            activeConfigProfileUuid: 'ff294d9d-be14-4610-ae9d-701e4c307dd0',
            activeInbounds: [visionInbound.uuid],
        },
    };

    const managed = CreateNodeCommand.RequestBodySchema.parse(baseBody);
    assert.equal(managed.creationMode, NODE_CREATION_MODES.MANAGED);

    const external = CreateNodeCommand.RequestBodySchema.parse({
        ...baseBody,
        creationMode: NODE_CREATION_MODES.EXTERNAL_IMPORT,
    });
    assert.equal(external.creationMode, NODE_CREATION_MODES.EXTERNAL_IMPORT);

    assert.equal(
        CreateNodeCommand.RequestBodySchema.safeParse({
            ...baseBody,
            creationMode: 'UNTRUSTED_MODE',
        }).success,
        false,
    );
    assert.equal(
        CreateNodeCommand.RequestBodySchema.safeParse({
            ...baseBody,
            configProfile: { ...baseBody.configProfile, activeInbounds: [] },
        }).success,
        false,
    );
    assert.equal(
        CreateNodeCommand.RequestBodySchema.safeParse({
            ...baseBody,
            configProfile: {
                ...baseBody.configProfile,
                activeInbounds: [visionInbound.uuid, visionInbound.uuid],
            },
        }).success,
        false,
    );
});

test('new-node policy follows server type and rejects protocols outside the creation whitelist', () => {
    assert.equal(
        validateManagedNodeCreation(SERVER_TYPES.PUBLIC_DIRECT, [
            visionInbound,
            xhttpInbound,
            socksInbound,
            anyTlsInbound,
        ]),
        null,
    );
    assert.equal(validateManagedNodeCreation(SERVER_TYPES.BROADBAND_LANDING, [socksInbound]), null);
    assert.equal(validateManagedNodeCreation(SERVER_TYPES.LEASED_LINE, [mieruInbound]), null);
    assert.match(
        validateManagedNodeCreation(SERVER_TYPES.BROADBAND_LANDING, [visionInbound]) ?? '',
        /not allowed/,
    );
    assert.match(
        validateManagedNodeCreation(SERVER_TYPES.LEASED_LINE, [socksInbound]) ?? '',
        /not allowed/,
    );
    assert.match(
        validateManagedNodeCreation(SERVER_TYPES.PUBLIC_DIRECT, [
            buildInbound({
                type: 'trojan',
                rawInbound: { protocol: 'trojan', settings: { clients: [] } },
            }),
        ]) ?? '',
        /not in the managed creation whitelist/,
    );
    assert.match(
        validateManagedNodeCreation(SERVER_TYPES.PUBLIC_DIRECT, [
            buildInbound({
                type: 'vless',
                network: 'raw',
                security: 'reality',
                rawInbound: {
                    settings: { clients: [] },
                    streamSettings: { network: 'raw', security: 'reality' },
                },
            }),
        ]) ?? '',
        /not in the managed creation whitelist/,
    );
    assert.match(
        validateManagedNodeCreation(SERVER_TYPES.PUBLIC_DIRECT, [
            buildInbound({
                type: 'vless',
                network: 'raw',
                security: 'reality',
                rawInbound: {
                    protocol: 'trojan',
                    settings: { clients: [] },
                    streamSettings: { network: 'raw', security: 'reality' },
                },
            }),
        ]) ?? '',
        /not in the managed creation whitelist/,
    );
    assert.match(
        validateManagedNodeCreation(SERVER_TYPES.LEASED_LINE, [
            buildInbound({ type: 'mieru', rawInbound: { type: 'mieru', imported: true } }),
        ]) ?? '',
        /mieru/i,
    );
});

test('createNode validates profile and server policy before writing a Nodes record', async () => {
    let createCalls = 0;
    const repository = {
        async create() {
            createCalls += 1;
            throw new Error('create must not be called');
        },
    };
    const queryBus = {
        async execute() {
            return {
                isOk: true,
                response: {
                    inbounds: [visionInbound],
                },
            };
        },
    };
    const service = new NodesService(
        repository as never,
        {} as never,
        {} as never,
        queryBus as never,
        {} as never,
        {} as never,
    );

    const result = await service.createNode({
        name: 'blocked-node',
        address: 'node.example.com',
        serverType: SERVER_TYPES.BROADBAND_LANDING,
        configProfile: {
            activeConfigProfileUuid: 'ff294d9d-be14-4610-ae9d-701e4c307dd0',
            activeInbounds: [visionInbound.uuid],
        },
    } as never);

    assert.equal(result.isOk, false);
    if (!result.isOk) {
        assert.equal(result.code, ERRORS.INVALID_MANAGED_INBOUND_FOR_SERVER_TYPE.code);
    }
    assert.equal(createCalls, 0);
});

test('createNode permits an explicitly imported legacy inbound without persisting creation mode', async () => {
    const legacyInbound = buildInbound({
        type: 'trojan',
        rawInbound: { protocol: 'trojan', settings: { clients: [] } },
    });
    let persistedEntity: Record<string, unknown> | undefined;
    let persistedInboundUuids: string[] | undefined;
    let startCalls = 0;

    const queryBus = {
        async execute() {
            return {
                isOk: true,
                response: { inbounds: [legacyInbound] },
            };
        },
    };
    const queues = {
        async startNode() {
            startCalls += 1;
        },
    };
    const service = new NodesService(
        {} as never,
        { emit() {} } as never,
        queues as never,
        queryBus as never,
        {} as never,
        {
            async getOne() {
                return {
                    system: null,
                    onlineUsers: 0,
                    versions: null,
                    xrayUptime: 0,
                };
            },
        } as never,
    );

    const serviceWithPersistence = service as unknown as {
        createNodeWithInbounds: (
            entity: Record<string, unknown>,
            activeInbounds: string[],
        ) => Promise<Record<string, unknown>>;
    };
    serviceWithPersistence.createNodeWithInbounds = async (entity, activeInbounds) => {
        persistedEntity = entity;
        persistedInboundUuids = activeInbounds;
        Object.assign(entity, {
            id: 1n,
            uuid: 'e99a8641-d12d-45af-a165-9768fcf19909',
            activeInbounds: [legacyInbound],
            consumptionMultiplier: 1_000_000_000n,
            nodeConsumptionMultiplier: 1_000_000_000n,
        });
        return entity;
    };

    const result = await service.createNode({
        creationMode: NODE_CREATION_MODES.EXTERNAL_IMPORT,
        name: 'legacy-import',
        address: 'legacy.example.com',
        serverType: SERVER_TYPES.LEASED_LINE,
        configProfile: {
            activeConfigProfileUuid: 'ff294d9d-be14-4610-ae9d-701e4c307dd0',
            activeInbounds: [legacyInbound.uuid],
        },
    } as never);

    assert.equal(result.isOk, true);
    assert.equal(startCalls, 1);
    assert.deepEqual(persistedInboundUuids, [legacyInbound.uuid]);
    assert.equal(Object.hasOwn(persistedEntity ?? {}, 'creationMode'), false);
});

test('createNode rejects duplicate inbounds before querying or writing', async () => {
    let queryCalls = 0;
    const service = new NodesService(
        {} as never,
        {} as never,
        {} as never,
        {
            async execute() {
                queryCalls += 1;
                throw new Error('query must not be called');
            },
        } as never,
        {} as never,
        {} as never,
    );

    const result = await service.createNode({
        creationMode: NODE_CREATION_MODES.EXTERNAL_IMPORT,
        name: 'duplicate-node',
        address: 'duplicate.example.com',
        configProfile: {
            activeConfigProfileUuid: 'ff294d9d-be14-4610-ae9d-701e4c307dd0',
            activeInbounds: [visionInbound.uuid, visionInbound.uuid],
        },
    } as never);

    assert.equal(result.isOk, false);
    if (!result.isOk) {
        assert.equal(result.code, ERRORS.INVALID_NODE_INBOUNDS.code);
    }
    assert.equal(queryCalls, 0);
});

test('external import still rejects an inbound outside the selected profile', async () => {
    let persistenceCalls = 0;
    const service = new NodesService(
        {} as never,
        {} as never,
        {} as never,
        {
            async execute() {
                return {
                    isOk: true,
                    response: { inbounds: [visionInbound] },
                };
            },
        } as never,
        {} as never,
        {} as never,
    );
    (
        service as unknown as {
            createNodeWithInbounds: () => Promise<never>;
        }
    ).createNodeWithInbounds = async () => {
        persistenceCalls += 1;
        throw new Error('persistence must not be called');
    };

    const result = await service.createNode({
        creationMode: NODE_CREATION_MODES.EXTERNAL_IMPORT,
        name: 'foreign-inbound',
        address: 'foreign.example.com',
        configProfile: {
            activeConfigProfileUuid: 'ff294d9d-be14-4610-ae9d-701e4c307dd0',
            activeInbounds: ['a8a3d4d2-e2ae-4118-a5bb-9458d2c589a1'],
        },
    } as never);

    assert.equal(result.isOk, false);
    if (!result.isOk) {
        assert.equal(
            result.code,
            ERRORS.CONFIG_PROFILE_INBOUND_NOT_FOUND_IN_SPECIFIED_PROFILE.code,
        );
    }
    assert.equal(persistenceCalls, 0);
});
