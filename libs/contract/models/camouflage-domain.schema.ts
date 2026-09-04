import { z } from 'zod';

export const CAMOUFLAGE_DOMAIN_AGENT_VALIDATION_PATH = '/node/camouflage-domain/validate' as const;

export const CAMOUFLAGE_DOMAIN_REGIONS = {
    LOS_ANGELES: 'LOS_ANGELES',
    SAN_JOSE: 'SAN_JOSE',
    TOKYO: 'TOKYO',
    SINGAPORE: 'SINGAPORE',
    FRANKFURT: 'FRANKFURT',
    LONDON: 'LONDON',
    AMSTERDAM: 'AMSTERDAM',
} as const;

export const CAMOUFLAGE_DOMAIN_SEED_STATUS = {
    CANDIDATE: 'CANDIDATE',
    CONDITIONAL: 'CONDITIONAL',
} as const;

export const CAMOUFLAGE_DOMAIN_VALIDATION_FAILURES = {
    VALIDATION_STALE: 'VALIDATION_STALE',
    REGION_MISMATCH: 'REGION_MISMATCH',
    DNS_RESOLUTION_FAILED: 'DNS_RESOLUTION_FAILED',
    DNS_BOGON: 'DNS_BOGON',
    CLOUDFLARE_DETECTED: 'CLOUDFLARE_DETECTED',
    TLS_1_3_REQUIRED: 'TLS_1_3_REQUIRED',
    HTTP_2_REQUIRED: 'HTTP_2_REQUIRED',
    X25519_REQUIRED: 'X25519_REQUIRED',
    CERTIFICATE_SAN_MISMATCH: 'CERTIFICATE_SAN_MISMATCH',
    CERTIFICATE_TOO_CLOSE_TO_EXPIRY: 'CERTIFICATE_TOO_CLOSE_TO_EXPIRY',
    REDIRECT_DETECTED: 'REDIRECT_DETECTED',
    INSUFFICIENT_MAINLAND_EVIDENCE: 'INSUFFICIENT_MAINLAND_EVIDENCE',
    MAINLAND_EVIDENCE_EXPIRED: 'MAINLAND_EVIDENCE_EXPIRED',
} as const;

export const CAMOUFLAGE_DOMAIN_CLOUDFLARE_SIGNALS = {
    ASN: 'ASN',
    IP_RANGE: 'IP_RANGE',
    CNAME: 'CNAME',
    HTTP_HEADER: 'HTTP_HEADER',
} as const;

const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export const CamouflageDomainSchema = z
    .string()
    .transform((value) => value.trim().toLowerCase().replace(/\.$/, ''))
    .pipe(
        z
            .string()
            .min(4)
            .max(253)
            .refine(
                (value) =>
                    value.includes('.') &&
                    value.split('.').every((label) => HOST_LABEL.test(label)) &&
                    !/^\d+(?:\.\d+){3}$/.test(value),
                'A fully qualified domain name is required',
            ),
    );

const AsnSchema = z.string().regex(/^AS[1-9]\d*$/);
const DateTimeSchema = z.iso.datetime();

export const CamouflageDomainSeedEvidenceSchema = z
    .object({
        source: z.literal('INITIAL_RESEARCH_SNAPSHOT'),
        observedAt: DateTimeSchema,
        expiresAt: DateTimeSchema,
        methodology: z.string().min(1),
    })
    .strict();

export const CamouflageDomainSeedSchema = z
    .object({
        domain: CamouflageDomainSchema,
        region: z.enum(CAMOUFLAGE_DOMAIN_REGIONS),
        provider: z.string().min(1),
        asn: AsnSchema,
        status: z.enum(CAMOUFLAGE_DOMAIN_SEED_STATUS),
        evidence: CamouflageDomainSeedEvidenceSchema,
    })
    .strict();

/**
 * Exact request body sent by the Panel to POST /node/camouflage-domain/validate.
 * The Node Agent must perform every network observation from the selected Node.
 */
export const CamouflageDomainAgentValidationRequestSchema = z
    .object({
        domain: CamouflageDomainSchema,
        expectedRegion: z.enum(CAMOUFLAGE_DOMAIN_REGIONS),
        requirements: z
            .object({
                tlsVersion: z.literal('TLSv1.3'),
                httpProtocol: z.literal('h2'),
                keyExchangeGroup: z.literal('X25519'),
                minimumCertificateValidityDays: z.literal(14),
                maximumRedirects: z.literal(0),
                minimumDistinctMainlandProbeAsns: z.literal(2),
                maximumMainlandEvidenceAgeHours: z.literal(24),
                rejectCloudflare: z.literal(true),
                requireCertificateSanMatch: z.literal(true),
            })
            .strict(),
    })
    .strict();

export const CamouflageDomainAgentValidationReportSchema = z
    .object({
        domain: CamouflageDomainSchema,
        expectedRegion: z.enum(CAMOUFLAGE_DOMAIN_REGIONS),
        checkedAt: DateTimeSchema,
        dns: z
            .object({
                addresses: z.array(z.union([z.ipv4(), z.ipv6()])).max(32),
                cnameChain: z.array(CamouflageDomainSchema).max(16),
                /** SHA-256 over canonical domain, A/AAAA set, CNAME chain and edge ASN or "unknown". */
                fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
                containsBogon: z.boolean(),
            })
            .strict(),
        edge: z
            .object({
                /** Null means the Agent has no trustworthy IP-to-provider evidence. */
                provider: z.string().min(1).max(128).nullable(),
                /** Null means the Agent has no trustworthy IP-to-ASN evidence. */
                asn: AsnSchema.nullable(),
                /** Null means the Agent cannot independently geolocate the resolved edge. */
                observedRegion: z.enum(CAMOUFLAGE_DOMAIN_REGIONS).nullable(),
            })
            .strict(),
        cloudflare: z
            .object({
                detected: z.boolean(),
                signals: z
                    .array(z.enum(CAMOUFLAGE_DOMAIN_CLOUDFLARE_SIGNALS))
                    .max(Object.keys(CAMOUFLAGE_DOMAIN_CLOUDFLARE_SIGNALS).length),
            })
            .strict(),
        tls: z
            .object({
                version: z.string().min(1).max(32),
                cipherSuite: z.string().min(1).max(128),
                keyExchangeGroup: z.string().min(1).max(64),
                certificate: z
                    .object({
                        sans: z.array(z.string().min(1).max(253)).min(1).max(256),
                        sanMatches: z.boolean(),
                        notBefore: DateTimeSchema,
                        notAfter: DateTimeSchema,
                    })
                    .strict(),
            })
            .strict(),
        http: z
            .object({
                negotiatedProtocol: z.string().min(1).max(32),
                statusCode: z.int().min(100).max(599),
                /** Number of redirects observed. The Agent never follows them. */
                redirectCount: z.int().min(0).max(20),
                serverHeader: z.string().max(512).nullable(),
                locationHeader: z.string().max(2_048).nullable(),
            })
            .strict(),
        mainlandProbes: z
            .array(
                z
                    .object({
                        probeId: z.string().min(1).max(128),
                        countryCode: z.literal('CN'),
                        asn: AsnSchema,
                        reachable: z.boolean(),
                        checkedAt: DateTimeSchema,
                    })
                    .strict(),
            )
            .max(32),
    })
    .strict();

export const CamouflageDomainAgentValidationResponseSchema = z
    .object({
        response: CamouflageDomainAgentValidationReportSchema,
    })
    .strict();

export const CamouflageDomainValidationSchema = z
    .object({
        source: z.literal('NODE_AGENT_LIVE'),
        nodeUuid: z.uuid(),
        report: CamouflageDomainAgentValidationReportSchema,
        eligible: z.boolean(),
        failures: z.array(z.enum(CAMOUFLAGE_DOMAIN_VALIDATION_FAILURES)),
        cachedAt: DateTimeSchema,
        expiresAt: DateTimeSchema,
    })
    .strict();

export const CamouflageDomainCatalogEntrySchema = CamouflageDomainSeedSchema.extend({
    researchEvidenceExpired: z.boolean(),
    latestValidation: CamouflageDomainValidationSchema.nullable(),
    canAutoSelect: z.boolean(),
});

export type TCamouflageDomainRegion = z.infer<
    typeof CamouflageDomainAgentValidationRequestSchema
>['expectedRegion'];
export type TCamouflageDomainSeed = z.infer<typeof CamouflageDomainSeedSchema>;
export type TCamouflageDomainAgentValidationRequest = z.infer<
    typeof CamouflageDomainAgentValidationRequestSchema
>;
export type TCamouflageDomainAgentValidationReport = z.infer<
    typeof CamouflageDomainAgentValidationReportSchema
>;
export type TCamouflageDomainValidation = z.infer<typeof CamouflageDomainValidationSchema>;
