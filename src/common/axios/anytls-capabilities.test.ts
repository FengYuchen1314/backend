import 'reflect-metadata';
import { AxiosError } from 'axios';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AxiosService } from './axios.service';

test('only a 404 capability probe permits legacy fallback; malformed/auth/network failures cannot downgrade', async () => {
    const options = { address: 'node.example.com', port: 2222, proxyUrl: null };
    const service = new AxiosService({} as never);
    Object.assign(service, { ensureJwt: async () => {}, resolveAgent: () => undefined });
    const probe = async (value: unknown) => {
        service.axiosInstance.get = (async () => {
            if (value instanceof Error) throw value;
            return { data: { response: value } };
        }) as never;
        return service.getAnyTlsCapabilities(options);
    };
    for (const value of [
        { available: true, coordinatedStartVersion: 1 },
        { available: false, coordinatedStartVersion: null },
    ]) {
        const result = await probe(value);
        assert.equal(result.isOk, true);
        if (result.isOk) assert.deepEqual(result.response, value);
    }
    const httpError = (status: number) =>
        new AxiosError('probe failure', 'ERR_BAD_RESPONSE', undefined, undefined, {
            status,
        } as never);
    const legacy = await probe(httpError(404));
    assert.equal(legacy.isOk, true);
    if (legacy.isOk)
        assert.deepEqual(legacy.response, { available: false, coordinatedStartVersion: null });
    for (const value of [
        httpError(401),
        httpError(403),
        httpError(500),
        new AxiosError('timeout', 'ETIMEDOUT'),
        {},
        { available: false, coordinatedStartVersion: 1 },
        { available: true, coordinatedStartVersion: 2 },
    ])
        assert.equal((await probe(value)).isOk, false);
});
