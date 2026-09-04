import { CamouflageDomainValidationSchema, TCamouflageDomainValidation } from '@contract/models';

import { Injectable } from '@nestjs/common';

import { RawCacheService } from '@common/raw-cache';

import { normalizeCamouflageDomain } from './camouflage-domain.policy';

const CACHE_NAMESPACE = 'camouflage-domain-validation:v1';

export function buildCamouflageDomainValidationCacheKey(
    nodeUuid: string,
    domain: string,
    dnsFingerprint: string,
): string {
    const normalizedDomain = normalizeCamouflageDomain(domain);
    if (!normalizedDomain) {
        throw new Error('Invalid camouflage domain');
    }

    return `${CACHE_NAMESPACE}:result:${nodeUuid}:${normalizedDomain}:${dnsFingerprint}`;
}

export function buildCamouflageDomainLatestPointerKey(nodeUuid: string, domain: string): string {
    const normalizedDomain = normalizeCamouflageDomain(domain);
    if (!normalizedDomain) {
        throw new Error('Invalid camouflage domain');
    }

    return `${CACHE_NAMESPACE}:latest:${nodeUuid}:${normalizedDomain}`;
}

@Injectable()
export class CamouflageDomainCacheService {
    constructor(private readonly rawCacheService: RawCacheService) {}

    async set(validation: TCamouflageDomainValidation, now: Date = new Date()): Promise<void> {
        const ttlSeconds = Math.max(
            1,
            Math.floor((Date.parse(validation.expiresAt) - now.getTime()) / 1_000),
        );
        const resultKey = buildCamouflageDomainValidationCacheKey(
            validation.nodeUuid,
            validation.report.domain,
            validation.report.dns.fingerprint,
        );
        const pointerKey = buildCamouflageDomainLatestPointerKey(
            validation.nodeUuid,
            validation.report.domain,
        );

        await this.rawCacheService.setMany([
            { key: resultKey, value: validation, ttlSeconds },
            {
                key: pointerKey,
                value: { dnsFingerprint: validation.report.dns.fingerprint },
                ttlSeconds,
            },
        ]);
    }

    async getLatest(
        nodeUuid: string,
        domain: string,
        now: Date = new Date(),
    ): Promise<TCamouflageDomainValidation | null> {
        const normalizedDomain = normalizeCamouflageDomain(domain);
        if (!normalizedDomain) {
            return null;
        }

        const pointerKey = buildCamouflageDomainLatestPointerKey(nodeUuid, domain);
        const pointer = await this.rawCacheService.get<{ dnsFingerprint?: unknown }>(pointerKey);

        if (!pointer) {
            return null;
        }
        if (
            typeof pointer.dnsFingerprint !== 'string' ||
            !/^[a-f0-9]{64}$/.test(pointer.dnsFingerprint)
        ) {
            await this.rawCacheService.del(pointerKey);
            return null;
        }

        const resultKey = buildCamouflageDomainValidationCacheKey(
            nodeUuid,
            domain,
            pointer.dnsFingerprint,
        );
        const raw = await this.rawCacheService.get<unknown>(resultKey);
        const parsed = CamouflageDomainValidationSchema.safeParse(raw);

        if (
            !parsed.success ||
            parsed.data.nodeUuid !== nodeUuid ||
            parsed.data.report.domain !== normalizedDomain ||
            parsed.data.report.dns.fingerprint !== pointer.dnsFingerprint ||
            Date.parse(parsed.data.expiresAt) <= now.getTime()
        ) {
            await this.rawCacheService.del(pointerKey);
            return null;
        }

        return parsed.data;
    }
}
