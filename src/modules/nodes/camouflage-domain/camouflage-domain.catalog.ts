import {
    CAMOUFLAGE_DOMAIN_REGIONS,
    CAMOUFLAGE_DOMAIN_SEED_STATUS,
    TCamouflageDomainSeed,
} from '@contract/models';

const OBSERVED_AT = '2026-09-04T12:00:00.000Z';
const EXPIRES_AT = '2026-09-05T12:00:00.000Z';
const METHODOLOGY =
    'Initial DNS/TLS reachability research only. This is not a current availability guarantee; Node-side live validation is mandatory.';

function seed(
    domain: string,
    region: TCamouflageDomainSeed['region'],
    provider: string,
    asn: string,
    status: TCamouflageDomainSeed['status'] = CAMOUFLAGE_DOMAIN_SEED_STATUS.CANDIDATE,
): TCamouflageDomainSeed {
    return {
        domain,
        region,
        provider,
        asn,
        status,
        evidence: {
            source: 'INITIAL_RESEARCH_SNAPSHOT',
            observedAt: OBSERVED_AT,
            expiresAt: EXPIRES_AT,
            methodology: METHODOLOGY,
        },
    };
}

/**
 * Expiring discovery seeds. No entry in this catalog is trusted for automatic selection until
 * the target Node Agent has produced a fresh, policy-compliant validation report.
 */
export const CAMOUFLAGE_DOMAIN_CATALOG: readonly TCamouflageDomainSeed[] = [
    seed('lax-ca-us-ping.vultr.com', CAMOUFLAGE_DOMAIN_REGIONS.LOS_ANGELES, 'Vultr', 'AS20473'),
    seed('lax.vultrcr.com', CAMOUFLAGE_DOMAIN_REGIONS.LOS_ANGELES, 'Vultr', 'AS20473'),
    seed('lax1.vultrobjects.com', CAMOUFLAGE_DOMAIN_REGIONS.LOS_ANGELES, 'Vultr', 'AS20473'),

    seed('sjo-ca-us-ping.vultr.com', CAMOUFLAGE_DOMAIN_REGIONS.SAN_JOSE, 'Vultr', 'AS20473'),
    seed('sjc.vultrcr.com', CAMOUFLAGE_DOMAIN_REGIONS.SAN_JOSE, 'Vultr', 'AS20473'),
    seed('sjc1.vultrobjects.com', CAMOUFLAGE_DOMAIN_REGIONS.SAN_JOSE, 'Vultr', 'AS20473'),

    seed('hnd-jp-ping.vultr.com', CAMOUFLAGE_DOMAIN_REGIONS.TOKYO, 'Vultr', 'AS20473'),
    seed('nrt1.vultrobjects.com', CAMOUFLAGE_DOMAIN_REGIONS.TOKYO, 'Vultr', 'AS20473'),
    seed(
        'www.yahoo.co.jp',
        CAMOUFLAGE_DOMAIN_REGIONS.TOKYO,
        'Yahoo Japan',
        'AS23816',
        CAMOUFLAGE_DOMAIN_SEED_STATUS.CONDITIONAL,
    ),

    seed('sgp-ping.vultr.com', CAMOUFLAGE_DOMAIN_REGIONS.SINGAPORE, 'Vultr', 'AS20473'),
    seed(
        'sgp1.digitaloceanspaces.com',
        CAMOUFLAGE_DOMAIN_REGIONS.SINGAPORE,
        'DigitalOcean',
        'AS14061',
    ),
    seed('sgp1.vultrobjects.com', CAMOUFLAGE_DOMAIN_REGIONS.SINGAPORE, 'Vultr', 'AS20473'),

    seed('fra-de-ping.vultr.com', CAMOUFLAGE_DOMAIN_REGIONS.FRANKFURT, 'Vultr', 'AS20473'),
    seed(
        'fra1.digitaloceanspaces.com',
        CAMOUFLAGE_DOMAIN_REGIONS.FRANKFURT,
        'DigitalOcean',
        'AS14061',
    ),
    seed('s3.eu-central-4.ionoscloud.com', CAMOUFLAGE_DOMAIN_REGIONS.FRANKFURT, 'IONOS', 'AS8560'),

    seed('lon-gb-ping.vultr.com', CAMOUFLAGE_DOMAIN_REGIONS.LONDON, 'Vultr', 'AS20473'),
    seed(
        'lon1.digitaloceanspaces.com',
        CAMOUFLAGE_DOMAIN_REGIONS.LONDON,
        'DigitalOcean',
        'AS14061',
    ),
    seed('lhr1.vultrobjects.com', CAMOUFLAGE_DOMAIN_REGIONS.LONDON, 'Vultr', 'AS20473'),

    seed('ams-nl-ping.vultr.com', CAMOUFLAGE_DOMAIN_REGIONS.AMSTERDAM, 'Vultr', 'AS20473'),
    seed(
        'ams3.digitaloceanspaces.com',
        CAMOUFLAGE_DOMAIN_REGIONS.AMSTERDAM,
        'DigitalOcean',
        'AS14061',
    ),
    seed('ams1.vultrobjects.com', CAMOUFLAGE_DOMAIN_REGIONS.AMSTERDAM, 'Vultr', 'AS20473'),
] as const;

export const CAMOUFLAGE_DOMAIN_CATALOG_VERSION = '2026-09-04.1';
