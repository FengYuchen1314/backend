import { UpdateNodeEdgeSettingsCommand } from '@contract/commands';
import { SERVER_TYPES } from '@contract/constants';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { QueryBus } from '@nestjs/cqrs';

import { AxiosService } from '@common/axios';

import { NodesRepository } from '../repositories/nodes.repository';
import { NodeEdgeSettingsRepository } from './node-edge-settings.repository';
import { NodeEdgeSettingsService } from './node-edge-settings.service';

const draft = {
    expectedRevision: 4,
    settings: {
        management: null,
        website: { domains: ['website.example.com'], upstream: 'http://127.0.0.1:3000/' },
    },
};
function fixture() {
    const node = {
        id: 1n,
        serverType: SERVER_TYPES.PUBLIC_DIRECT,
        address: '198.51.100.1',
        activeConfigProfileUuid: null,
        activeInbounds: [],
    };
    let saved = 0;
    let accept = true;
    const service = new NodeEdgeSettingsService(
        { findByUUID: async () => node } as unknown as NodesRepository,
        {
            save: async (_id: bigint, version: number) => {
                assert.equal(version, 4);
                saved++;
                return accept;
            },
        } as unknown as NodeEdgeSettingsRepository,
        {} as QueryBus,
        {} as AxiosService,
    );
    return {
        node,
        service,
        saved: () => saved,
        conflict: () => {
            accept = false;
        },
    };
}
test('edge settings save a revision without claiming runtime activation', async () => {
    const f = fixture();
    const result = await f.service.save('node', draft);
    assert.deepEqual(result, { isOk: true, response: { revision: 5, settings: draft.settings } });
    assert.equal(f.saved(), 1);
});
test('stale edge settings receive a conflict and do not silently overwrite', async () => {
    const f = fixture();
    f.conflict();
    const result = await f.service.save('node', draft);
    assert.equal(result.isOk, false);
    if (!result.isOk) assert.equal(result.code, 'XE001');
});
test('edge saves reject wrong server type and self-loop before persistence', async () => {
    const f = fixture();
    assert.equal(
        (
            await f.service.save('node', {
                ...draft,
                settings: {
                    management: null,
                    website: { ...draft.settings.website, upstream: 'https://198.51.100.1/' },
                },
            })
        ).isOk,
        false,
    );
    Object.assign(f.node, { serverType: SERVER_TYPES.LEASED_LINE });
    assert.equal((await f.service.save('node', draft)).isOk, false);
    assert.equal(f.saved(), 0);
});
test('edge contracts reject proxy paths, credentials, fragments, duplicate domains and unsafe hostnames', () => {
    for (const upstream of [
        'http://127.0.0.1:3000/path',
        'http://user:pass@host/',
        'http://host/#x',
        'http://host/?x=1',
        'http://{host}/',
    ]) {
        assert.equal(
            UpdateNodeEdgeSettingsCommand.RequestBodySchema.safeParse({
                ...draft,
                settings: { management: null, website: { ...draft.settings.website, upstream } },
            }).success,
            false,
        );
    }
    assert.equal(
        UpdateNodeEdgeSettingsCommand.RequestBodySchema.safeParse({
            ...draft,
            settings: { management: draft.settings.website, website: draft.settings.website },
        }).success,
        false,
    );
});
