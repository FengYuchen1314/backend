import {
    CAMOUFLAGE_DOMAIN_SEED_STATUS,
    CAMOUFLAGE_DOMAIN_VALIDATION_FAILURES,
    CamouflageDomainSchema,
    TCamouflageDomainAgentValidationReport,
    TCamouflageDomainSeed,
    TCamouflageDomainValidation,
} from '@contract/models';

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;
const MINIMUM_CERTIFICATE_VALIDITY_MS = 14 * DAY_MS;
const MAXIMUM_SUCCESS_CACHE_MS = 6 * HOUR_MS;
const FAILURE_CACHE_MS = 15 * 60 * 1_000;
const MAXIMUM_REPORT_AGE_MS = 15 * 60 * 1_000;
const MAXIMUM_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1_000;

type TFailure = TCamouflageDomainValidation['failures'][number];

export interface ICamouflageDomainPolicyEvaluation {
    eligible: boolean;
    failures: TFailure[];
    ttlSeconds: number;
}

function isCloudflare(report: TCamouflageDomainAgentValidationReport): boolean {
    return (
        report.cloudflare.detected ||
        report.edge.asn === 'AS13335' ||
        (report.edge.provider?.toLowerCase().includes('cloudflare') ?? false) ||
        report.dns.cnameChain.some((name) => name.includes('cloudflare')) ||
        (report.http.serverHeader?.toLowerCase().includes('cloudflare') ?? false)
    );
}

function getFreshMainlandProbeExpiries(
    report: TCamouflageDomainAgentValidationReport,
    nowMs: number,
): { distinctReachableAsns: number; distinctFreshAsns: number; secondFreshestExpiry: number } {
    const newestReachableCheckByAsn = new Map<string, number>();

    for (const probe of report.mainlandProbes) {
        if (!probe.reachable) continue;
        const checkedAt = Date.parse(probe.checkedAt);
        const current = newestReachableCheckByAsn.get(probe.asn) ?? Number.NEGATIVE_INFINITY;
        newestReachableCheckByAsn.set(probe.asn, Math.max(current, checkedAt));
    }

    const freshExpiries = [...newestReachableCheckByAsn.values()]
        .map((checkedAt) => checkedAt + DAY_MS)
        .filter(
            (expiresAt) =>
                expiresAt > nowMs && expiresAt - DAY_MS <= nowMs + MAXIMUM_FUTURE_CLOCK_SKEW_MS,
        )
        .sort((left, right) => right - left);

    return {
        distinctReachableAsns: newestReachableCheckByAsn.size,
        distinctFreshAsns: freshExpiries.length,
        secondFreshestExpiry: freshExpiries[1] ?? 0,
    };
}

export function evaluateCamouflageDomainValidation(
    report: TCamouflageDomainAgentValidationReport,
    now: Date = new Date(),
): ICamouflageDomainPolicyEvaluation {
    const nowMs = now.getTime();
    const reportCheckedAt = Date.parse(report.checkedAt);
    const certificateNotAfter = Date.parse(report.tls.certificate.notAfter);
    const failures = new Set<TFailure>();

    if (
        reportCheckedAt > nowMs + MAXIMUM_FUTURE_CLOCK_SKEW_MS ||
        nowMs - reportCheckedAt > MAXIMUM_REPORT_AGE_MS
    ) {
        failures.add(CAMOUFLAGE_DOMAIN_VALIDATION_FAILURES.VALIDATION_STALE);
    }
    if (
        report.edge.observedRegion !== null &&
        report.edge.observedRegion !== report.expectedRegion
    ) {
        failures.add(CAMOUFLAGE_DOMAIN_VALIDATION_FAILURES.REGION_MISMATCH);
    }
    if (report.dns.addresses.length === 0) {
        failures.add(CAMOUFLAGE_DOMAIN_VALIDATION_FAILURES.DNS_RESOLUTION_FAILED);
    }
    if (report.dns.containsBogon) {
        failures.add(CAMOUFLAGE_DOMAIN_VALIDATION_FAILURES.DNS_BOGON);
    }
    if (isCloudflare(report)) {
        failures.add(CAMOUFLAGE_DOMAIN_VALIDATION_FAILURES.CLOUDFLARE_DETECTED);
    }
    if (report.tls.version !== 'TLSv1.3') {
        failures.add(CAMOUFLAGE_DOMAIN_VALIDATION_FAILURES.TLS_1_3_REQUIRED);
    }
    if (report.http.negotiatedProtocol !== 'h2') {
        failures.add(CAMOUFLAGE_DOMAIN_VALIDATION_FAILURES.HTTP_2_REQUIRED);
    }
    if (!report.tls.keyExchangeGroup.toUpperCase().startsWith('X25519')) {
        failures.add(CAMOUFLAGE_DOMAIN_VALIDATION_FAILURES.X25519_REQUIRED);
    }
    if (!report.tls.certificate.sanMatches) {
        failures.add(CAMOUFLAGE_DOMAIN_VALIDATION_FAILURES.CERTIFICATE_SAN_MISMATCH);
    }
    if (certificateNotAfter - nowMs <= MINIMUM_CERTIFICATE_VALIDITY_MS) {
        failures.add(CAMOUFLAGE_DOMAIN_VALIDATION_FAILURES.CERTIFICATE_TOO_CLOSE_TO_EXPIRY);
    }
    if (
        report.http.redirectCount !== 0 ||
        (report.http.statusCode >= 300 && report.http.statusCode < 400) ||
        report.http.locationHeader !== null
    ) {
        failures.add(CAMOUFLAGE_DOMAIN_VALIDATION_FAILURES.REDIRECT_DETECTED);
    }

    const probeEvidence = getFreshMainlandProbeExpiries(report, nowMs);
    if (probeEvidence.distinctReachableAsns < 2) {
        failures.add(CAMOUFLAGE_DOMAIN_VALIDATION_FAILURES.INSUFFICIENT_MAINLAND_EVIDENCE);
    } else if (probeEvidence.distinctFreshAsns < 2) {
        failures.add(CAMOUFLAGE_DOMAIN_VALIDATION_FAILURES.MAINLAND_EVIDENCE_EXPIRED);
    }

    if (failures.size > 0) {
        return {
            eligible: false,
            failures: [...failures],
            ttlSeconds: FAILURE_CACHE_MS / 1_000,
        };
    }

    const expiresAt = Math.min(
        reportCheckedAt + MAXIMUM_SUCCESS_CACHE_MS,
        certificateNotAfter - MINIMUM_CERTIFICATE_VALIDITY_MS,
        probeEvidence.secondFreshestExpiry,
    );

    const ttlSeconds = Math.floor((expiresAt - nowMs) / 1_000);
    if (ttlSeconds <= 0) {
        return {
            eligible: false,
            failures: [CAMOUFLAGE_DOMAIN_VALIDATION_FAILURES.MAINLAND_EVIDENCE_EXPIRED],
            ttlSeconds: FAILURE_CACHE_MS / 1_000,
        };
    }

    return { eligible: true, failures: [], ttlSeconds };
}

export function buildCamouflageDomainValidation(
    nodeUuid: string,
    report: TCamouflageDomainAgentValidationReport,
    now: Date = new Date(),
): TCamouflageDomainValidation {
    const evaluation = evaluateCamouflageDomainValidation(report, now);
    const expiresAt = new Date(now.getTime() + evaluation.ttlSeconds * 1_000);

    return {
        source: 'NODE_AGENT_LIVE',
        nodeUuid,
        report,
        eligible: evaluation.eligible,
        failures: evaluation.failures,
        cachedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
    };
}

export function normalizeCamouflageDomain(domain: string): string | null {
    const result = CamouflageDomainSchema.safeParse(domain);
    return result.success ? result.data : null;
}

export function canAutoSelectCamouflageDomain(
    seed: TCamouflageDomainSeed,
    validation: TCamouflageDomainValidation | null,
    nodeUuid: string,
    occupiedDomains: ReadonlySet<string>,
    now: Date = new Date(),
): boolean {
    return Boolean(
        seed.status === CAMOUFLAGE_DOMAIN_SEED_STATUS.CANDIDATE &&
        validation?.eligible &&
        validation.nodeUuid === nodeUuid &&
        validation.report.domain === seed.domain &&
        validation.report.expectedRegion === seed.region &&
        Date.parse(seed.evidence.expiresAt) > now.getTime() &&
        Date.parse(validation.expiresAt) > now.getTime() &&
        !isCloudflare(validation.report) &&
        !occupiedDomains.has(seed.domain),
    );
}

export function selectCamouflageDomain(
    candidates: ReadonlyArray<{
        seed: TCamouflageDomainSeed;
        validation: TCamouflageDomainValidation | null;
    }>,
    options: {
        nodeUuid: string;
        occupiedDomains: ReadonlySet<string>;
        now?: Date;
    },
): { seed: TCamouflageDomainSeed; validation: TCamouflageDomainValidation } | null {
    const existingProviders = new Set<string>();
    const existingAsns = new Set<string>();

    for (const occupied of options.occupiedDomains) {
        const existing = candidates.find(({ seed }) => seed.domain === occupied)?.seed;
        if (existing) {
            existingProviders.add(existing.provider.toLowerCase());
            existingAsns.add(existing.asn);
        }
    }

    const eligible = candidates
        .filter(
            (
                item,
            ): item is {
                seed: TCamouflageDomainSeed;
                validation: TCamouflageDomainValidation;
            } =>
                item.validation !== null &&
                canAutoSelectCamouflageDomain(
                    item.seed,
                    item.validation,
                    options.nodeUuid,
                    options.occupiedDomains,
                    options.now,
                ),
        )
        .map((item, index) => ({
            ...item,
            index,
            diversityScore:
                (existingAsns.has(item.validation.report.edge.asn ?? item.seed.asn) ? 0 : 2) +
                (existingProviders.has(
                    (item.validation.report.edge.provider ?? item.seed.provider).toLowerCase(),
                )
                    ? 0
                    : 1),
        }))
        .sort(
            (left, right) =>
                right.diversityScore - left.diversityScore ||
                left.index - right.index ||
                left.seed.domain.localeCompare(right.seed.domain),
        );

    return eligible[0] ?? null;
}

export const CAMOUFLAGE_DOMAIN_POLICY_LIMITS = {
    successCacheSeconds: MAXIMUM_SUCCESS_CACHE_MS / 1_000,
    failureCacheSeconds: FAILURE_CACHE_MS / 1_000,
    mainlandEvidenceSeconds: DAY_MS / 1_000,
    minimumCertificateValidityDays: 14,
    minimumDistinctMainlandProbeAsns: 2,
} as const;
