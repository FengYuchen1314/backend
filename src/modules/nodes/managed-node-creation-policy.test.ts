import 'reflect-metadata';
import { ERRORS, SERVER_TYPES } from '@contract/constants';
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
        settings: { auth: 'password', users: [] },
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

test('managed presets are classified without treating imported raw protocols as managed', () => {
    assert.equal(getManagedNodeProtocol(socksInbound), 'SOCKS5');
    assert.equal(getManagedNodeProtocol(visionInbound), 'VLESS_REALITY_VISION');
    assert.equal(getManagedNodeProtocol(xhttpInbound), 'VLESS_XHTTP_REALITY_XMUX');
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

test('new-node policy follows server type and rejects protocols outside the creation whitelist', () => {
    assert.equal(
        validateManagedNodeCreation(SERVER_TYPES.PUBLIC_DIRECT, [
            visionInbound,
            xhttpInbound,
            socksInbound,
        ]),
        null,
    );
    assert.equal(validateManagedNodeCreation(SERVER_TYPES.BROADBAND_LANDING, [socksInbound]), null);
    assert.match(
        validateManagedNodeCreation(SERVER_TYPES.BROADBAND_LANDING, [visionInbound]) ?? '',
        /not allowed/,
    );
    assert.match(
        validateManagedNodeCreation(SERVER_TYPES.LEASED_LINE, [socksInbound]) ?? '',
        /Mieru/,
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
        /Mieru/,
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
