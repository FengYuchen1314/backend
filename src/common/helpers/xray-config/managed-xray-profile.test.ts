import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { anyTlsDefinition, anyTlsProfile } from '@modules/anytls/anytls.test-fixtures';

import { ManagedXrayProfile } from './managed-xray-profile';
import { XRayConfig } from './xray-config.validator';

test('namespaced AnyTLS profile keeps synthetic inbounds out of native Xray and does not mutate input', () => {
    const input = anyTlsProfile();
    const before = structuredClone(input);
    const profile = new ManagedXrayProfile(input);
    assert.deepEqual(input, before);
    assert.equal(Object.hasOwn(profile.xray.getConfig(), 'xboardAnyTls'), false);
    assert.deepEqual(profile.xray.getConfig().inbounds, []);
    assert.equal(profile.getAllInbounds()[0]?.type, 'anytls');
    assert.deepEqual((profile.getSortedConfig() as typeof input).xboardAnyTls, input.xboardAnyTls);
    assert.doesNotMatch(
        JSON.stringify(profile.getAllInbounds()),
        /privateKey|Password|certificate|users/,
    );
    assert.throws(() => new XRayConfig({ inbounds: [] }), /inbound/i);
    assert.throws(
        () => new ManagedXrayProfile({ inbounds: [], xboardAnyTls: { version: 1, listeners: [] } }),
        /inbound/i,
    );
});

test('AnyTLS profiles reject unknown fields, private identities, port collisions and Cloudflare CDN', () => {
    const definition = anyTlsDefinition();
    for (const listener of [
        { ...definition, wrapperPassword: 'w'.repeat(32) },
        { ...definition, tls: { privateKey: 'private' } },
        { ...definition, innerPort: definition.wrapperPort },
        { ...definition, innerPort: 15998 },
        { ...definition, wrapperPort: 18080 },
        { ...definition, camouflage: { ...definition.camouflage, address: '104.16.1.1' } },
        {
            ...definition,
            camouflage: { ...definition.camouflage, serverName: 'www.cloudflare.com' },
        },
    ])
        assert.throws(
            () =>
                new ManagedXrayProfile({
                    ...anyTlsProfile(),
                    xboardAnyTls: { version: 1, listeners: [listener] },
                }),
        );
    for (const port of [14001, '14442-14444', '1080,14001'])
        assert.throws(
            () =>
                new ManagedXrayProfile({
                    ...anyTlsProfile(),
                    inbounds: [{ tag: 'SOCKS', protocol: 'socks', port, settings: {} }],
                }),
            /ports overlap/,
        );
    assert.throws(
        () =>
            new ManagedXrayProfile({
                ...anyTlsProfile(),
                inbounds: [{ tag: definition.tag, protocol: 'socks', port: 1080, settings: {} }],
            }),
        /tags.*unique/,
    );
    assert.throws(
        () =>
            new ManagedXrayProfile({
                ...anyTlsProfile(),
                inbounds: [
                    {
                        tag: 'VISION',
                        protocol: 'vless',
                        port: 443,
                        settings: {},
                        streamSettings: {
                            realitySettings: {
                                serverNames: [definition.camouflage.serverName.toUpperCase()],
                            },
                        },
                    },
                ],
            }),
        /SNI.*unique/,
    );
});
