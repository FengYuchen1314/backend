import {
    CAMOUFLAGE_DOMAIN_REGIONS,
    CAMOUFLAGE_DOMAIN_SEED_STATUS,
    CAMOUFLAGE_DOMAIN_VALIDATION_FAILURES,
    TCamouflageDomainAgentValidationReport,
    TCamouflageDomainSeed,
} from '@contract/models';
import assert from 'node:assert/strict';
import test from 'node:test';

import { RawCacheService } from '@common/raw-cache';

import {
    buildCamouflageDomainLatestPointerKey,
    buildCamouflageDomainValidationCacheKey,
    CamouflageDomainCacheService,
} from './camouflage-domain-cache.service';
import { CAMOUFLAGE_DOMAIN_CATALOG } from './camouflage-domain.catalog';
import {
    buildCamouflageDomainValidation,
    canAutoSelectCamouflageDomain,
    evaluateCamouflageDomainValidation,
    selectCamouflageDomain,
} from './camouflage-domain.policy';

const NODE_UUID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-09-04T12:30:00.000Z');
const FINGERPRINT = 'a'.repeat(64);

function report(
    domain: string,
    overrides: Partial<TCamouflageDomainAgentValidationReport> = {},
): TCamouflageDomainAgentValidationReport {
    return {
        domain,
        expectedRegion: CAMOUFLAGE_DOMAIN_REGIONS.SINGAPORE,
        checkedAt: NOW.toISOString(),
        dns: {
            addresses: ['203.0.113.10'],
            cnameChain: [],
            fingerprint: FINGERPRINT,
            containsBogon: false,
        },
        edge: {
            provider: 'DigitalOcean',
            asn: 'AS14061',
            observedRegion: CAMOUFLAGE_DOMAIN_REGIONS.SINGAPORE,
        },
        cloudflare: { detected: false, signals: [] },
        tls: {
            version: 'TLSv1.3',
            cipherSuite: 'TLS_AES_128_GCM_SHA256',
            keyExchangeGroup: 'X25519',
            certificate: {
                sans: [domain],
                sanMatches: true,
                notBefore: '2026-08-01T00:00:00.000Z',
                notAfter: '2026-11-01T00:00:00.000Z',
            },
        },
        http: {
            negotiatedProtocol: 'h2',
            statusCode: 200,
            redirectCount: 0,
            serverHeader: null,
            locationHeader: null,
        },
        mainlandProbes: [
            {
                probeId: 'telecom',
                countryCode: 'CN',
                asn: 'AS4134',
                reachable: true,
                checkedAt: NOW.toISOString(),
            },
            {
                probeId: 'unicom',
                countryCode: 'CN',
                asn: 'AS4837',
                reachable: true,
                checkedAt: NOW.toISOString(),
            },
        ],
        ...overrides,
    };
}

function seed(
    domain: string,
    provider: string,
    asn: string,
    status: TCamouflageDomainSeed['status'] = CAMOUFLAGE_DOMAIN_SEED_STATUS.CANDIDATE,
): TCamouflageDomainSeed {
    return {
        domain,
        region: CAMOUFLAGE_DOMAIN_REGIONS.SINGAPORE,
        provider,
        asn,
        status,
        evidence: {
            source: 'INITIAL_RESEARCH_SNAPSHOT',
            observedAt: NOW.toISOString(),
            expiresAt: new Date(NOW.getTime() + 86_400_000).toISOString(),
            methodology: 'test snapshot',
        },
    };
}

test('policy accepts only a fresh complete report and caps a success at six hours', () => {
    const result = evaluateCamouflageDomainValidation(report('sgp1.digitaloceanspaces.com'), NOW);

    assert.equal(result.eligible, true);
    assert.deepEqual(result.failures, []);
    assert.equal(result.ttlSeconds, 6 * 60 * 60);
});

test('catalog contains three discovery seeds per region and never marks conditional as selectable', () => {
    for (const region of Object.values(CAMOUFLAGE_DOMAIN_REGIONS)) {
        assert.ok(CAMOUFLAGE_DOMAIN_CATALOG.filter((item) => item.region === region).length >= 3);
    }

    const conditional = CAMOUFLAGE_DOMAIN_CATALOG.filter(
        (item) => item.status === CAMOUFLAGE_DOMAIN_SEED_STATUS.CONDITIONAL,
    );
    assert.deepEqual(
        conditional.map((item) => item.domain),
        ['www.yahoo.co.jp'],
    );
    assert.ok(
        CAMOUFLAGE_DOMAIN_CATALOG.every(
            (item) => item.asn !== 'AS13335' && !item.provider.toLowerCase().includes('cloudflare'),
        ),
    );
});

test('policy caps success before the certificate falls below the 14-day safety margin', () => {
    const notAfter = new Date(NOW.getTime() + 14 * 86_400_000 + 45 * 60_000).toISOString();
    const value = report('sgp1.digitaloceanspaces.com');
    value.tls.certificate.notAfter = notAfter;

    const result = evaluateCamouflageDomainValidation(value, NOW);

    assert.equal(result.eligible, true);
    assert.equal(result.ttlSeconds, 45 * 60);
});

test('policy fails closed for Cloudflare and evidence from fewer than two mainland ASNs', () => {
    const value = report('sgp1.digitaloceanspaces.com');
    value.cloudflare = { detected: true, signals: ['ASN'] };
    value.mainlandProbes[1]!.asn = value.mainlandProbes[0]!.asn;

    const result = evaluateCamouflageDomainValidation(value, NOW);

    assert.equal(result.eligible, false);
    assert.equal(result.ttlSeconds, 15 * 60);
    assert.ok(result.failures.includes(CAMOUFLAGE_DOMAIN_VALIDATION_FAILURES.CLOUDFLARE_DETECTED));
    assert.ok(
        result.failures.includes(
            CAMOUFLAGE_DOMAIN_VALIDATION_FAILURES.INSUFFICIENT_MAINLAND_EVIDENCE,
        ),
    );
});

test('mainland evidence older than 24 hours is never eligible', () => {
    const value = report('sgp1.digitaloceanspaces.com');
    const stale = new Date(NOW.getTime() - 24 * 60 * 60 * 1_000 - 1).toISOString();
    value.mainlandProbes = value.mainlandProbes.map((probe) => ({
        ...probe,
        checkedAt: stale,
    }));

    const result = evaluateCamouflageDomainValidation(value, NOW);

    assert.equal(result.eligible, false);
    assert.equal(result.ttlSeconds, 15 * 60);
    assert.ok(
        result.failures.includes(CAMOUFLAGE_DOMAIN_VALIDATION_FAILURES.MAINLAND_EVIDENCE_EXPIRED),
    );
});

test('Cloudflare IPv4/IPv6 or reported signals cannot be hidden by a false detected flag', () => {
    for (const address of ['104.16.1.2', '172.64.0.1', '2606:4700::1', '::ffff:104.16.1.2']) {
        const value = report('example.com');
        value.dns.addresses = ['203.0.113.10', address];
        const result = evaluateCamouflageDomainValidation(value, NOW);
        assert.equal(result.eligible, false, address);
        assert.ok(
            result.failures.includes(CAMOUFLAGE_DOMAIN_VALIDATION_FAILURES.CLOUDFLARE_DETECTED),
        );
        const oldCache = buildCamouflageDomainValidation(NODE_UUID, value, NOW);
        oldCache.eligible = true;
        assert.equal(
            canAutoSelectCamouflageDomain(
                seed('example.com', 'DigitalOcean', 'AS14061'),
                oldCache,
                NODE_UUID,
                new Set(),
                NOW,
            ),
            false,
            'A previously eligible cache entry must not bypass the current CDN exclusion',
        );
    }
    const value = report('example.com');
    value.cloudflare = { detected: false, signals: ['HTTP_HEADER'] };
    assert.ok(
        evaluateCamouflageDomainValidation(value, NOW).failures.includes(
            CAMOUFLAGE_DOMAIN_VALIDATION_FAILURES.CLOUDFLARE_DETECTED,
        ),
    );
});

test('cache key includes node, normalized domain, and DNS fingerprint', () => {
    assert.equal(
        buildCamouflageDomainValidationCacheKey(
            NODE_UUID,
            ' SGP1.DigitalOceanSpaces.com. ',
            FINGERPRINT,
        ),
        `camouflage-domain-validation:v1:result:${NODE_UUID}:sgp1.digitaloceanspaces.com:${FINGERPRINT}`,
    );
});

test('cache stores the exact result and refuses it after policy expiry', async () => {
    const values = new Map<string, unknown>();
    const ttls = new Map<string, number | undefined>();
    const rawCache = {
        async setMany(entries: Array<{ key: string; value: unknown; ttlSeconds?: number }>) {
            for (const entry of entries) {
                values.set(entry.key, entry.value);
                ttls.set(entry.key, entry.ttlSeconds);
            }
        },
        async get<T>(key: string): Promise<T | null> {
            return (values.get(key) as T | undefined) ?? null;
        },
        async del(key: string) {
            values.delete(key);
        },
    } as RawCacheService;
    const cache = new CamouflageDomainCacheService(rawCache);
    const validation = buildCamouflageDomainValidation(
        NODE_UUID,
        report('sgp1.digitaloceanspaces.com'),
        NOW,
    );

    await cache.set(validation, NOW);
    assert.equal(
        ttls.get(
            buildCamouflageDomainValidationCacheKey(
                NODE_UUID,
                validation.report.domain,
                validation.report.dns.fingerprint,
            ),
        ),
        6 * 60 * 60,
    );
    assert.deepEqual(await cache.getLatest(NODE_UUID, validation.report.domain, NOW), validation);
    assert.equal(
        await cache.getLatest(
            NODE_UUID,
            validation.report.domain,
            new Date(Date.parse(validation.expiresAt) + 1),
        ),
        null,
    );
    assert.equal(
        values.has(buildCamouflageDomainLatestPointerKey(NODE_UUID, validation.report.domain)),
        false,
    );
});

test('selection rejects conditional and occupied names and favors provider/ASN diversity', () => {
    const occupiedSeed = seed('sgp-ping.vultr.com', 'Vultr', 'AS20473');
    const sameNetworkSeed = seed('sgp1.vultrobjects.com', 'Vultr', 'AS20473');
    const diverseSeed = seed('sgp1.digitaloceanspaces.com', 'DigitalOcean', 'AS14061');
    const conditionalSeed = seed(
        'conditional.example.com',
        'Example',
        'AS64500',
        CAMOUFLAGE_DOMAIN_SEED_STATUS.CONDITIONAL,
    );
    const items = [occupiedSeed, sameNetworkSeed, diverseSeed, conditionalSeed].map((item) => {
        const validationReport = report(item.domain, {
            edge: {
                provider: item.provider,
                asn: item.asn,
                observedRegion: item.region,
            },
        });
        return {
            seed: item,
            validation: buildCamouflageDomainValidation(NODE_UUID, validationReport, NOW),
        };
    });
    const occupied = new Set([occupiedSeed.domain]);

    assert.equal(
        canAutoSelectCamouflageDomain(
            conditionalSeed,
            items[3]!.validation,
            NODE_UUID,
            occupied,
            NOW,
        ),
        false,
    );

    const selected = selectCamouflageDomain(items, {
        nodeUuid: NODE_UUID,
        occupiedDomains: occupied,
        now: NOW,
    });

    assert.equal(selected?.seed.domain, diverseSeed.domain);
});

test('selection refuses an expired discovery seed even when its live report is still cached', () => {
    const expired = seed('expired.example.com', 'Example', 'AS64500');
    expired.evidence.expiresAt = new Date(NOW.getTime() - 1).toISOString();
    const validation = buildCamouflageDomainValidation(
        NODE_UUID,
        report(expired.domain, {
            edge: { provider: null, asn: null, observedRegion: null },
        }),
        NOW,
    );

    assert.equal(
        canAutoSelectCamouflageDomain(expired, validation, NODE_UUID, new Set(), NOW),
        false,
    );
});

test('policy treats a 3xx or Location header as a redirect without following it', () => {
    const value = report('sgp1.digitaloceanspaces.com');
    value.http.statusCode = 302;
    value.http.locationHeader = 'https://example.com/';

    const result = evaluateCamouflageDomainValidation(value, NOW);

    assert.equal(result.eligible, false);
    assert.ok(result.failures.includes(CAMOUFLAGE_DOMAIN_VALIDATION_FAILURES.REDIRECT_DETECTED));
});
