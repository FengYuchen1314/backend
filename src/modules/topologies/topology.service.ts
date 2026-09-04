import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

import { Injectable, Logger } from '@nestjs/common';

import { fail, ok, TResult } from '@common/types';
import { ERRORS } from '@libs/contracts/constants';
import {
    TTopology,
    TTopologyFormat,
    TTopologyGraph,
    TTopologyPreviewResult,
    TTopologyValidationResult,
} from '@libs/contracts/models';

import { TopologyCompiler } from './topology.compiler';
import { TopologyRepository } from './topology.repository';
import { TopologyValidator } from './topology.validator';

@Injectable()
export class TopologyService {
    private readonly logger = new Logger(TopologyService.name);

    constructor(
        private readonly repository: TopologyRepository,
        private readonly validator: TopologyValidator,
        private readonly compiler: TopologyCompiler,
    ) {}

    public async getAll(): Promise<TResult<{ topologies: TTopology[]; total: number }>> {
        try {
            const topologies = await this.repository.findAll();
            return ok({ topologies, total: topologies.length });
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.GET_TOPOLOGY_ERROR);
        }
    }

    public async getByUuid(uuid: string): Promise<TResult<TTopology>> {
        try {
            const topology = await this.repository.findByUuid(uuid);
            return topology ? ok(topology) : fail(ERRORS.TOPOLOGY_NOT_FOUND);
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.GET_TOPOLOGY_ERROR);
        }
    }

    public async validateGraph(graph: TTopologyGraph): Promise<TResult<TTopologyValidationResult>> {
        try {
            const references = await this.repository.getReferenceSnapshot(graph);
            return ok(this.validator.validate(graph, references));
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.GET_TOPOLOGY_ERROR);
        }
    }

    public async preview(
        graph: TTopologyGraph,
        requestedFormats: TTopologyFormat[],
    ): Promise<
        TResult<
            TTopologyValidationResult & {
                results: TTopologyPreviewResult[];
            }
        >
    > {
        const validation = await this.validateGraph(graph);
        if (!validation.isOk) return validation;

        const formats = [...new Set(requestedFormats)];
        if (!validation.response.valid) {
            return ok({
                ...validation.response,
                results: formats.map((format) => ({
                    format,
                    status: 'ERROR' as const,
                    reasonCode: 'INVALID_TOPOLOGY',
                    message: 'Compilation was skipped because the topology is invalid.',
                })),
            });
        }

        return ok({
            ...validation.response,
            results: formats.map((format) => this.compiler.compile(graph, format)),
        });
    }

    public async create(name: string, graph: TTopologyGraph): Promise<TResult<TTopology>> {
        try {
            const validation = await this.validateGraph(graph);
            if (!validation.isOk) return validation;
            if (!validation.response.valid) {
                return fail(
                    ERRORS.INVALID_TOPOLOGY.withMessage(validation.response.issues[0]!.message),
                );
            }
            if (await this.repository.nameExists(name)) {
                return fail(ERRORS.TOPOLOGY_NAME_ALREADY_EXISTS);
            }
            return ok(await this.repository.create(name, graph));
        } catch (error) {
            this.logger.error(error);
            if (this.isUniqueViolation(error)) {
                return fail(ERRORS.TOPOLOGY_NAME_ALREADY_EXISTS);
            }
            return fail(ERRORS.CREATE_TOPOLOGY_ERROR);
        }
    }

    public async update(
        uuid: string,
        expectedVersion: number,
        name?: string,
        graph?: TTopologyGraph,
    ): Promise<TResult<TTopology>> {
        try {
            const current = await this.repository.findByUuid(uuid);
            if (!current) return fail(ERRORS.TOPOLOGY_NOT_FOUND);
            if (current.version !== expectedVersion) {
                return fail(ERRORS.TOPOLOGY_VERSION_CONFLICT);
            }

            const nextName = name ?? current.name;
            const nextGraph = graph ?? current.graph;
            if (graph) {
                const validation = await this.validateGraph(graph);
                if (!validation.isOk) return validation;
                if (!validation.response.valid) {
                    return fail(
                        ERRORS.INVALID_TOPOLOGY.withMessage(validation.response.issues[0]!.message),
                    );
                }
            }
            if (await this.repository.nameExists(nextName, uuid)) {
                return fail(ERRORS.TOPOLOGY_NAME_ALREADY_EXISTS);
            }

            const updated = await this.repository.updateIfVersion(
                uuid,
                expectedVersion,
                nextName,
                nextGraph,
            );
            return updated ? ok(updated) : fail(ERRORS.TOPOLOGY_VERSION_CONFLICT);
        } catch (error) {
            this.logger.error(error);
            if (this.isUniqueViolation(error)) {
                return fail(ERRORS.TOPOLOGY_NAME_ALREADY_EXISTS);
            }
            return fail(ERRORS.UPDATE_TOPOLOGY_ERROR);
        }
    }

    public async delete(uuid: string, expectedVersion: number): Promise<TResult<boolean>> {
        try {
            const current = await this.repository.findByUuid(uuid);
            if (!current) return fail(ERRORS.TOPOLOGY_NOT_FOUND);
            if (current.version !== expectedVersion) {
                return fail(ERRORS.TOPOLOGY_VERSION_CONFLICT);
            }

            const deleted = await this.repository.deleteIfVersion(uuid, expectedVersion);
            return deleted ? ok(true) : fail(ERRORS.TOPOLOGY_VERSION_CONFLICT);
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.DELETE_TOPOLOGY_ERROR);
        }
    }

    private isUniqueViolation(error: unknown): boolean {
        if (error instanceof PrismaClientKnownRequestError) {
            return (
                error.code === 'P2002' || (error.code === 'P2010' && error.meta?.code === '23505')
            );
        }
        return false;
    }
}
