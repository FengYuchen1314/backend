import 'reflect-metadata';
import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { test } from 'node:test';
import { connect, createServer } from 'node:tls';

import {
    AnyTlsMaterial,
    anyTlsClientIdentity,
    deriveAnyTlsPassword,
    issueAnyTlsMaterial,
    validateAnyTlsMaterial,
} from './anytls-identity';
import { AnyTlsMaterialService } from './anytls-material.service';
import { ANYTLS_UUID } from './anytls.test-fixtures';

test('issued AnyTLS leaf validates against its private CA and exact inner SAN over real TLS', async () => {
    const material = await issueAnyTlsMaterial(ANYTLS_UUID);
    const identity = anyTlsClientIdentity(material);
    assert.deepEqual(Object.keys(identity).sort(), [
        'caFingerprint',
        'serverName',
        'shadowPassword',
        'wrapperPassword',
    ]);
    assert.match(identity.caFingerprint, /^[0-9a-f]{64}$/);
    assert.notEqual(material.wrapperPassword, material.shadowPassword);
    const server = createServer(
        { key: material.tls.privateKey, cert: material.tls.certificate },
        (socket) => socket.end('authenticated'),
    );
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
        const address = server.address();
        assert.ok(address && typeof address !== 'string');
        const received = await new Promise<string>((resolve, reject) => {
            const socket = connect({
                host: '127.0.0.1',
                port: address.port,
                servername: identity.serverName,
                ca: material.tls.caCertificate,
                rejectUnauthorized: true,
            });
            let body = '';
            socket.setTimeout(5000, () => socket.destroy(new Error('TLS fixture timed out')));
            socket.on('data', (data) => (body += data.toString()));
            socket.once('error', reject);
            socket.once('end', () => resolve(body));
        });
        assert.equal(received, 'authenticated');
    } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
});

test('leaf renewal preserves client CA pin and transport credentials but rotates the leaf key', async () => {
    const now = new Date();
    const first = await issueAnyTlsMaterial(ANYTLS_UUID, undefined, now);
    const next = await issueAnyTlsMaterial(
        ANYTLS_UUID,
        first,
        new Date(now.getTime() + 65 * 86400000),
    );
    assert.deepEqual(anyTlsClientIdentity(next), anyTlsClientIdentity(first));
    assert.notEqual(next.tls.certificate, first.tls.certificate);
    assert.notEqual(next.tls.privateKey, first.tls.privateKey);
    assert.ok(
        Date.parse(new X509Certificate(next.tls.certificate).validTo) >
            Date.parse(new X509Certificate(first.tls.certificate).validTo),
    );
});

test('stored AnyTLS identities reject wrong inbound, key, CA, expired leaf and shared secrets', async () => {
    const first = await issueAnyTlsMaterial(ANYTLS_UUID);
    const other = await issueAnyTlsMaterial('33333333-3333-4333-8333-333333333333');
    for (const mutation of [
        { ...first, shadowPassword: first.wrapperPassword },
        { ...first, caPrivateKey: other.caPrivateKey },
        { ...first, tls: { ...first.tls, privateKey: other.tls.privateKey } },
        { ...first, tls: { ...first.tls, certificate: other.tls.certificate } },
        { ...first, tls: { ...first.tls, caCertificate: other.tls.caCertificate } },
    ])
        assert.throws(() => validateAnyTlsMaterial(mutation, ANYTLS_UUID));
    assert.throws(() => validateAnyTlsMaterial(first, '33333333-3333-4333-8333-333333333333'));
    assert.throws(() =>
        validateAnyTlsMaterial(first, ANYTLS_UUID, new Date(Date.now() + 91 * 86400000)),
    );
    assert.throws(() =>
        validateAnyTlsMaterial(first, ANYTLS_UUID, new Date(Date.now() - 86400000)),
    );
});

test('subscriber credentials are deterministic and isolated by inbound and subscriber', () => {
    const password = deriveAnyTlsPassword('user-1-secret', ANYTLS_UUID);
    assert.match(password, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(password, deriveAnyTlsPassword('user-1-secret', ANYTLS_UUID));
    assert.notEqual(password, deriveAnyTlsPassword('user-2-secret', ANYTLS_UUID));
    assert.notEqual(
        password,
        deriveAnyTlsPassword('user-1-secret', '33333333-3333-4333-8333-333333333333'),
    );
    assert.throws(() => deriveAnyTlsPassword('', ANYTLS_UUID));
});

test('concurrent preparation converges on one identity; subscription reads never rotate it', async () => {
    let row: { revision: number; material: AnyTlsMaterial } | null = null;
    let writes = 0;
    const repository = {
        async read() {
            return row && structuredClone(row);
        },
        async save(_uuid: string, revision: number, material: AnyTlsMaterial) {
            if ((row?.revision ?? 0) !== revision) return false;
            row = { revision: revision + 1, material };
            writes++;
            return true;
        },
    };
    const service = new AnyTlsMaterialService(repository as never, {} as never);
    await assert.rejects(service.clientIdentity(ANYTLS_UUID), /not provisioned/);
    const results = await Promise.all(Array.from({ length: 8 }, () => service.ensure(ANYTLS_UUID)));
    assert.equal(writes, 1);
    for (const result of results)
        assert.deepEqual(anyTlsClientIdentity(result), anyTlsClientIdentity(results[0]));
    const later = new Date(Date.now() + 65 * 86400000);
    await service.clientIdentity(ANYTLS_UUID, later);
    assert.equal(writes, 1);
    await service.ensure(ANYTLS_UUID, later);
    assert.equal(writes, 2);
    assert.deepEqual(
        await service.clientIdentity(ANYTLS_UUID, later),
        anyTlsClientIdentity(results[0]),
    );
});
