import {
    GetCamouflageDomainCatalogCommand,
    SelectCamouflageDomainCommand,
    ValidateCamouflageDomainCommand,
} from '@contract/commands';
import { ERRORS } from '@contract/constants';
import {
    CAMOUFLAGE_DOMAIN_SEED_STATUS,
    CamouflageDomainAgentValidationReportSchema,
    TCamouflageDomainAgentValidationRequest,
    TCamouflageDomainSeed,
    TCamouflageDomainValidation,
} from '@contract/models';

import { Injectable, Logger } from '@nestjs/common';

import { AxiosService } from '@common/axios';
import { fail, ok, TResult } from '@common/types';

import { NodesEntity } from '../entities';
import { NodesRepository } from '../repositories/nodes.repository';
import { CamouflageDomainCacheService } from './camouflage-domain-cache.service';
import {
    CAMOUFLAGE_DOMAIN_CATALOG,
    CAMOUFLAGE_DOMAIN_CATALOG_VERSION,
} from './camouflage-domain.catalog';
import {
    buildCamouflageDomainValidation,
    CAMOUFLAGE_DOMAIN_POLICY_LIMITS,
    canAutoSelectCamouflageDomain,
    normalizeCamouflageDomain,
    selectCamouflageDomain,
} from './camouflage-domain.policy';

const AGENT_REQUIREMENTS: TCamouflageDomainAgentValidationRequest['requirements'] = {
    tlsVersion: 'TLSv1.3',
    httpProtocol: 'h2',
    keyExchangeGroup: 'X25519',
    minimumCertificateValidityDays: 14,
    maximumRedirects: 0,
    minimumDistinctMainlandProbeAsns: 2,
    maximumMainlandEvidenceAgeHours: 24,
    rejectCloudflare: true,
    requireCertificateSanMatch: true,
};

type TCatalogResponse = GetCamouflageDomainCatalogCommand.Response['response'];
type TSelectionResponse = SelectCamouflageDomainCommand.Response['response'];

@Injectable()
export class CamouflageDomainService {
    private readonly logger = new Logger(CamouflageDomainService.name);

    constructor(
        private readonly nodesRepository: NodesRepository,
        private readonly axiosService: AxiosService,
        private readonly cacheService: CamouflageDomainCacheService,
    ) {}

    async getCatalog(nodeUuid?: string): Promise<TResult<TCatalogResponse>> {
        const now = new Date();
        let occupiedDomains = new Set<string>();
        let validations = new Map<string, TCamouflageDomainValidation | null>();

        if (nodeUuid) {
            const node = await this.nodesRepository.findByUUID(nodeUuid);
            if (!node) return fail(ERRORS.NODE_NOT_FOUND);

            occupiedDomains = await this.getOccupiedDomains(nodeUuid);
            validations = new Map(
                await Promise.all(
                    CAMOUFLAGE_DOMAIN_CATALOG.map(
                        async (seed) =>
                            [
                                seed.domain,
                                await this.cacheService.getLatest(nodeUuid, seed.domain, now),
                            ] as const,
                    ),
                ),
            );
        }

        return ok({
            catalogVersion: CAMOUFLAGE_DOMAIN_CATALOG_VERSION,
            requiresTargetNodeValidation: true,
            policy: {
                ...CAMOUFLAGE_DOMAIN_POLICY_LIMITS,
                fallback: 'USER_OWNED_DOMAIN_REQUIRED',
            },
            occupiedDomains: [...occupiedDomains].sort(),
            seeds: CAMOUFLAGE_DOMAIN_CATALOG.map((seed) => {
                const latestValidation = validations.get(seed.domain) ?? null;
                return {
                    ...seed,
                    researchEvidenceExpired: Date.parse(seed.evidence.expiresAt) <= now.getTime(),
                    latestValidation,
                    canAutoSelect: nodeUuid
                        ? canAutoSelectCamouflageDomain(
                              seed,
                              latestValidation,
                              nodeUuid,
                              occupiedDomains,
                              now,
                          )
                        : false,
                };
            }),
        });
    }

    async validate(
        nodeUuid: string,
        body: ValidateCamouflageDomainCommand.RequestBody,
    ): Promise<TResult<TCamouflageDomainValidation>> {
        const node = await this.nodesRepository.findByUUID(nodeUuid);
        if (!node) return fail(ERRORS.NODE_NOT_FOUND);

        return this.validateOnNode(node, body.domain, body.expectedRegion);
    }

    async select(
        nodeUuid: string,
        body: SelectCamouflageDomainCommand.RequestBody,
    ): Promise<TResult<TSelectionResponse>> {
        const node = await this.nodesRepository.findByUUID(nodeUuid);
        if (!node) return fail(ERRORS.NODE_NOT_FOUND);
        if (!this.canContactNode(node)) {
            return fail(
                ERRORS.CAMOUFLAGE_DOMAIN_VALIDATION_UNAVAILABLE.withMessage(
                    'The selected node must be enabled and connected for live validation.',
                ),
            );
        }

        const occupiedDomains = await this.getOccupiedDomains(nodeUuid, body.reservedDomains);
        const now = new Date();
        const seeds = CAMOUFLAGE_DOMAIN_CATALOG.filter(
            (seed) =>
                seed.region === body.region && Date.parse(seed.evidence.expiresAt) > now.getTime(),
        );

        const candidates: Array<{
            seed: TCamouflageDomainSeed;
            validation: TCamouflageDomainValidation | null;
        }> = await Promise.all(
            seeds.map(async (seed) => {
                if (
                    occupiedDomains.has(seed.domain) ||
                    seed.status !== CAMOUFLAGE_DOMAIN_SEED_STATUS.CANDIDATE
                ) {
                    return { seed, validation: null };
                }

                const cached = await this.cacheService.getLatest(nodeUuid, seed.domain);
                if (cached) {
                    return { seed, validation: cached };
                }

                const result = await this.validateOnNode(node, seed.domain, seed.region);
                return {
                    seed,
                    validation: result.isOk ? result.response : null,
                };
            }),
        );

        const selected = selectCamouflageDomain(candidates, {
            nodeUuid,
            occupiedDomains,
            now,
        });

        if (!selected) {
            return fail(ERRORS.CAMOUFLAGE_DOMAIN_OWN_DOMAIN_REQUIRED);
        }

        return ok(selected);
    }

    private async validateOnNode(
        node: NodesEntity,
        domain: string,
        expectedRegion: TCamouflageDomainSeed['region'],
    ): Promise<TResult<TCamouflageDomainValidation>> {
        if (!this.canContactNode(node)) {
            return fail(
                ERRORS.CAMOUFLAGE_DOMAIN_VALIDATION_UNAVAILABLE.withMessage(
                    'The selected node must be enabled and connected for live validation.',
                ),
            );
        }

        const request: TCamouflageDomainAgentValidationRequest = {
            domain,
            expectedRegion,
            requirements: AGENT_REQUIREMENTS,
        };
        const agentResult = await this.axiosService.validateCamouflageDomain(request, {
            address: node.address,
            port: node.port,
            proxyUrl: node.proxyUrl,
        });

        if (!agentResult.isOk) {
            return agentResult;
        }

        const parsed = CamouflageDomainAgentValidationReportSchema.safeParse(agentResult.response);
        if (
            !parsed.success ||
            parsed.data.domain !== request.domain ||
            parsed.data.expectedRegion !== request.expectedRegion
        ) {
            this.logger.warn(
                `Node ${node.uuid} returned an invalid camouflage-domain validation response.`,
            );
            return fail(
                ERRORS.CAMOUFLAGE_DOMAIN_VALIDATION_UNAVAILABLE.withMessage(
                    'The selected node returned an invalid validation report.',
                ),
            );
        }

        const validation = buildCamouflageDomainValidation(node.uuid, parsed.data);
        await this.cacheService.set(validation);
        return ok(validation);
    }

    private canContactNode(node: NodesEntity): boolean {
        return node.isConnected && !node.isConnecting && !node.isDisabled;
    }

    private async getOccupiedDomains(
        nodeUuid: string,
        additional: readonly string[] = [],
    ): Promise<Set<string>> {
        const domains = await this.nodesRepository.findAssignedHostDomains(nodeUuid);
        return new Set(
            [...domains, ...additional]
                .map((domain) => normalizeCamouflageDomain(domain))
                .filter((domain): domain is string => domain !== null),
        );
    }
}
