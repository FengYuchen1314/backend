import { Job } from 'bullmq';
import semver from 'semver';

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { AxiosService } from '@common/axios/axios.service';
import { RawCacheService } from '@common/raw-cache';
import { formatExecutionTime, getTime } from '@common/utils/get-elapsed-time';
import { CACHE_KEYS, CACHE_KEYS_TTL, EVENTS } from '@libs/contracts/constants';

import { NodeEvent } from '@integration-modules/notifications/interfaces';

import { GetResolvedIntegrationsQuery } from '@modules/node-integrations/queries/get-resolved-integrations';
import { mergeNodeIntegrations } from '@modules/node-integrations/utils';
import { GetPluginByUuidQuery } from '@modules/node-plugins/queries/get-plugin-by-uuid';
import { UpdateNodeCommand } from '@modules/nodes/commands/update-node';
import { GetNodeByUuidQuery } from '@modules/nodes/queries/get-node-by-uuid';
import {
    GetPreparedConfigWithUsersQuery,
    IGetPreparedConfigWithUsersResponse,
} from '@modules/users/queries/get-prepared-config-with-users';
import { GetPreparedMitaConfigWithUsersQuery } from '@modules/users/queries/get-prepared-mita-config-with-users';

import { QUEUES_NAMES } from '@queue/queue.enum';

import { NODES_JOB_NAMES } from '../constants/nodes-job-name.constant';
import { IStartNodePayload, NodesQueuesService } from '../nodes-queues.service';

const NODE_REQUEST_ALREADY_IN_PROGRESS = 'Request already in progress';

export class RetryableStartNodeBusyError extends Error {
    constructor(nodeUuid: string, reason: string) {
        super(`Node ${nodeUuid} is busy: ${reason}`);
        this.name = RetryableStartNodeBusyError.name;
    }
}

@Processor(QUEUES_NAMES.NODES.START, {
    concurrency: 40,
})
export class StartNodeProcessor extends WorkerHost {
    private readonly logger = new Logger(StartNodeProcessor.name);

    constructor(
        private readonly axios: AxiosService,
        private readonly nodesQueuesService: NodesQueuesService,
        private readonly queryBus: QueryBus,
        private readonly eventEmitter: EventEmitter2,
        private readonly commandBus: CommandBus,
        private readonly rawCacheService: RawCacheService,
    ) {
        super();
    }

    async process(job: Job<IStartNodePayload>) {
        try {
            const { nodeUuid, force, retryIfBusy } = job.data;

            const nodeCheckup = await this.queryBus.execute(new GetNodeByUuidQuery(nodeUuid));

            if (!nodeCheckup.isOk) {
                this.logger.error(`Node ${nodeUuid} not found`);
                return;
            }

            const { response: node } = nodeCheckup;

            if (node.isConnecting) {
                if (retryIfBusy) {
                    throw new RetryableStartNodeBusyError(nodeUuid, 'database state isConnecting');
                }
                return;
            }

            await this.rawCacheService.delMany([
                CACHE_KEYS.NODE_SYSTEM_STATS(nodeUuid),
                CACHE_KEYS.NODE_USERS_ONLINE(nodeUuid),
                CACHE_KEYS.NODE_XRAY_UPTIME(nodeUuid),
            ]);

            if (node.activeInbounds.length === 0 || !node.activeConfigProfileUuid) {
                this.logger.warn(
                    `Node ${nodeUuid} has no active config profile or inbounds, disabling and clearing profile from node...`,
                );

                await this.commandBus.execute(
                    new UpdateNodeCommand({
                        uuid: node.uuid,
                        isDisabled: true,
                        activeConfigProfileUuid: null,
                        isConnecting: false,
                        isConnected: false,
                        lastStatusMessage: null,
                        lastStatusChange: new Date(),
                    }),
                );

                await this.nodesQueuesService.stopNode({
                    nodeUuid: node.uuid,
                    isNeedToBeDeleted: false,
                });

                return;
            }

            const mieruInboundCount = node.activeInbounds.filter(
                (inbound) => inbound.type.toLowerCase() === 'mieru',
            ).length;
            const isMieruRuntime = mieruInboundCount === node.activeInbounds.length;

            if (mieruInboundCount > 0 && !isMieruRuntime) {
                throw new Error('Xray and Mieru inbounds cannot share one physical node runtime.');
            }

            await this.commandBus.execute(
                new UpdateNodeCommand({
                    uuid: node.uuid,
                    isConnecting: true,
                }),
            );

            const xrayStatusResponse = await this.axios.getNodeHealth({
                address: node.address,
                port: node.port,
                proxyUrl: node.proxyUrl,
            });

            if (!xrayStatusResponse.isOk) {
                await this.commandBus.execute(
                    new UpdateNodeCommand({
                        uuid: node.uuid,
                        lastStatusMessage: xrayStatusResponse.message ?? null,
                        lastStatusChange: new Date(),
                        isConnected: false,
                        isConnecting: false,
                    }),
                );

                this.logger.error(
                    `Pre-check failed. Node: ${node.uuid} – ${node.address}:${node.port}, error: ${xrayStatusResponse.message}`,
                );

                return;
            }

            if (semver.lt(xrayStatusResponse.response.nodeVersion, '2.7.0')) {
                await this.commandBus.execute(
                    new UpdateNodeCommand({
                        uuid: node.uuid,
                        lastStatusMessage: `Outdated version ${xrayStatusResponse.response.nodeVersion} of Remnawave Node. Please upgrade to the latest version (>= 2.7.0).`,
                        lastStatusChange: new Date(),
                        isConnected: false,
                        isConnecting: false,
                    }),
                );

                this.logger.error(
                    `Outdated version ${xrayStatusResponse.response.nodeVersion} of Remnawave Node. Please upgrade to the latest version (>= 2.7.0).`,
                );

                return;
            }

            let plugin: {
                uuid: string;
                config: Record<string, unknown>;
                name: string;
            } | null = null;

            if (!isMieruRuntime && node.activePluginUuid) {
                const getNodePluginResult = await this.queryBus.execute(
                    new GetPluginByUuidQuery(node.activePluginUuid),
                );

                if (!getNodePluginResult.isOk) {
                    this.logger.error(`Failed to get node plugin: ${getNodePluginResult.message}`);
                    return;
                }
                const { response: nodePlugin } = getNodePluginResult;
                plugin = {
                    uuid: nodePlugin.uuid,
                    config: nodePlugin.pluginConfig as Record<string, unknown>,
                    name: nodePlugin.name,
                };
            }

            if (!isMieruRuntime) {
                const syncNodePluginsResponse = await this.axios.syncNodePlugins(
                    {
                        plugin,
                    },
                    {
                        address: node.address,
                        port: node.port,
                        proxyUrl: node.proxyUrl,
                    },
                );

                if (!syncNodePluginsResponse.isOk) {
                    await this.commandBus.execute(
                        new UpdateNodeCommand({
                            uuid: node.uuid,
                            isConnecting: false,
                            isConnected: false,
                            lastStatusMessage: `Failed to sync node plugins: ${syncNodePluginsResponse.message}`,
                            lastStatusChange: new Date(),
                        }),
                    );

                    this.logger.error(
                        `Failed to sync node plugins: ${syncNodePluginsResponse.message}`,
                    );
                    return;
                }
            }

            const startTime = getTime();
            const config = isMieruRuntime
                ? await this.queryBus.execute(
                      new GetPreparedMitaConfigWithUsersQuery(node.activeInbounds),
                  )
                : await this.queryBus.execute(
                      new GetPreparedConfigWithUsersQuery(
                          node.activeConfigProfileUuid,
                          node.activeInbounds,
                      ),
                  );

            this.logger.log(`Generated config for node in ${formatExecutionTime(startTime)}`);

            if (!config.isOk) {
                throw new Error('Failed to get config for node');
            }

            const reqStartTime = getTime();

            const connection = {
                address: node.address,
                port: node.port,
                proxyUrl: node.proxyUrl,
            };
            let startNodeResult: Awaited<ReturnType<AxiosService['startXray']>>;

            if (isMieruRuntime) {
                startNodeResult = await this.axios.startMieru(
                    { config: config.response as unknown as Record<string, unknown> },
                    connection,
                );
            } else {
                const integrationsResult = await this.queryBus.execute(
                    new GetResolvedIntegrationsQuery(node.integrationUuids),
                );

                if (!integrationsResult.isOk) {
                    throw new Error('Failed to resolve integrations for node');
                }

                const nodeIntegrations = mergeNodeIntegrations(
                    node.integrationUuids
                        .map((uuid) => integrationsResult.response.get(uuid))
                        .filter((integration) => integration !== undefined),
                );
                const xrayConfig = config.response as IGetPreparedConfigWithUsersResponse;

                startNodeResult = await this.axios.startXray(
                    {
                        xrayConfig: xrayConfig.config as unknown as Record<string, unknown>,
                        internals: {
                            hashes: xrayConfig.hashesPayload,
                            forceRestart: force ?? false,
                            metadata: {
                                uuid: node.uuid,
                                name: node.name,
                                countryCode: node.countryCode,
                                id: Number(node.id),
                                tags: node.tags,
                            },
                            integrations: nodeIntegrations,
                        },
                    },
                    connection,
                );
            }

            this.logger.log(`Started node in ${formatExecutionTime(reqStartTime)}`);

            if (!startNodeResult.isOk) {
                await this.commandBus.execute(
                    new UpdateNodeCommand({
                        uuid: node.uuid,
                        lastStatusMessage: startNodeResult.message ?? null,
                        lastStatusChange: new Date(),
                        isConnected: false,
                        isConnecting: false,
                    }),
                );

                if (
                    retryIfBusy &&
                    startNodeResult.message?.includes(NODE_REQUEST_ALREADY_IN_PROGRESS)
                ) {
                    throw new RetryableStartNodeBusyError(
                        nodeUuid,
                        NODE_REQUEST_ALREADY_IN_PROGRESS,
                    );
                }

                return;
            }

            const nodeResponse = startNodeResult.response;

            if (retryIfBusy && nodeResponse.error?.includes(NODE_REQUEST_ALREADY_IN_PROGRESS)) {
                throw new RetryableStartNodeBusyError(nodeUuid, NODE_REQUEST_ALREADY_IN_PROGRESS);
            }

            await this.rawCacheService.setMany([
                {
                    key: CACHE_KEYS.NODE_SYSTEM_INFO(node.uuid),
                    value: nodeResponse.system.info,
                },
                {
                    key: CACHE_KEYS.NODE_VERSIONS(node.uuid),
                    value:
                        nodeResponse.nodeInformation.version && nodeResponse.version
                            ? {
                                  xray: isMieruRuntime
                                      ? `Mita ${nodeResponse.version}`
                                      : nodeResponse.version,
                                  node: nodeResponse.nodeInformation.version,
                              }
                            : null,
                },
                {
                    key: CACHE_KEYS.NODE_SYSTEM_STATS(node.uuid),
                    value: nodeResponse.system.stats,
                    ttlSeconds: CACHE_KEYS_TTL.NODE_SYSTEM_STATS,
                },
            ]);

            const updateNodeResult = await this.commandBus.execute(
                new UpdateNodeCommand({
                    uuid: node.uuid,
                    isConnected: nodeResponse.isStarted,
                    lastStatusMessage: nodeResponse.error ?? null,
                    lastStatusChange: new Date(),
                    isConnecting: false,
                }),
            );

            if (!updateNodeResult.isOk) {
                this.logger.error(`Failed to update node ${node.uuid}`);
                return;
            }

            if (!node.isConnected && nodeResponse.isStarted) {
                this.eventEmitter.emit(
                    EVENTS.NODE.CONNECTION_RESTORED,
                    new NodeEvent(updateNodeResult.response, EVENTS.NODE.CONNECTION_RESTORED),
                );
            }

            return;
        } catch (error) {
            this.logger.error(`Error handling "${NODES_JOB_NAMES.START_NODE}" job: ${error}`);
            if (error instanceof RetryableStartNodeBusyError) {
                throw error;
            }
        }
    }
}
