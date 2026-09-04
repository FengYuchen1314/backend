import { GetUpdateStatusCommand, TriggerUpdateCommand } from '@contract/commands';
import {
    UPDATER_STATUS_STATES,
    UPDATER_TRIGGER_STATES,
    XBOARD_UPDATE_CHANNEL,
} from '@contract/constants';
import axios, { AxiosRequestConfig } from 'axios';
import { z } from 'zod';

import { Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '@common/config/app-config';
import { ok, TResult } from '@common/types';

const UPDATER_SECRET_HEADER = 'X-Xboard-Updater-Secret';
const MAX_UPDATER_RESPONSE_BYTES = 64 * 1_024;

const RemoteUpdaterStatusSchema = z
    .object({
        channel: z.literal(XBOARD_UPDATE_CHANNEL),
        state: z.enum({
            IDLE: UPDATER_STATUS_STATES.IDLE,
            UPDATING: UPDATER_STATUS_STATES.UPDATING,
            SUCCEEDED: UPDATER_STATUS_STATES.SUCCEEDED,
            FAILED: UPDATER_STATUS_STATES.FAILED,
        }),
        currentVersion: z.string().max(100).nullable(),
        targetVersion: z.string().max(100).nullable(),
        updateAvailable: z.boolean(),
        lastError: z.string().max(2_000).nullable(),
        updatedAt: z.iso.datetime().nullable(),
    })
    .strict();

const RemoteUpdaterTriggerSchema = z.discriminatedUnion('accepted', [
    z
        .object({
            accepted: z.literal(true),
            operationId: z.string().min(1).max(128),
            state: z.enum({
                QUEUED: UPDATER_TRIGGER_STATES.QUEUED,
                UPDATING: UPDATER_TRIGGER_STATES.UPDATING,
            }),
            message: z.string().max(2_000).nullable(),
        })
        .strict(),
    z
        .object({
            accepted: z.literal(false),
            operationId: z.string().min(1).max(128).nullable(),
            state: z.enum({
                UPDATING: UPDATER_TRIGGER_STATES.UPDATING,
                REJECTED: UPDATER_TRIGGER_STATES.REJECTED,
            }),
            message: z.string().max(2_000).nullable(),
        })
        .strict(),
]);

type UpdateStatus = GetUpdateStatusCommand.Response['response'];
type TriggerUpdateResult = TriggerUpdateCommand.Response['response'];

interface UpdaterConfig {
    baseUrl: string;
    secret: string;
    timeoutMs: number;
}

@Injectable()
export class PanelUpdaterService {
    private readonly logger = new Logger(PanelUpdaterService.name);

    constructor(private readonly configService: TypedConfigService) {}

    public async getStatus(): Promise<TResult<UpdateStatus>> {
        const config = this.getUpdaterConfig();
        if (!config) {
            return ok({
                configured: false,
                reachable: false,
                channel: XBOARD_UPDATE_CHANNEL,
                state: UPDATER_STATUS_STATES.UNCONFIGURED,
                currentVersion: null,
                targetVersion: null,
                updateAvailable: null,
                lastError: null,
                updatedAt: null,
            });
        }

        try {
            const response = await axios.get<unknown>(
                this.resolveUpdaterEndpoint(config.baseUrl, 'v1/status'),
                {
                    ...this.getRequestConfig(config),
                    params: { channel: XBOARD_UPDATE_CHANNEL },
                    validateStatus: (status) => status === 200,
                },
            );
            const parsed = RemoteUpdaterStatusSchema.safeParse(response.data);

            if (!parsed.success) {
                this.logger.warn('Updater status response did not match the configured contract');
                return ok(this.failedStatus('Updater returned an invalid status response'));
            }

            return ok({
                configured: true,
                reachable: true,
                ...parsed.data,
            });
        } catch (error) {
            this.logRequestFailure('status request', error);

            if (axios.isAxiosError(error) && error.response) {
                return ok(
                    this.failedStatus(
                        `Updater status request failed (HTTP ${error.response.status})`,
                    ),
                );
            }

            return ok({
                configured: true,
                reachable: false,
                channel: XBOARD_UPDATE_CHANNEL,
                state: UPDATER_STATUS_STATES.UNREACHABLE,
                currentVersion: null,
                targetVersion: null,
                updateAvailable: null,
                lastError: 'Updater service is unreachable',
                updatedAt: null,
            });
        }
    }

    public async triggerUpdate(): Promise<TResult<TriggerUpdateResult>> {
        const config = this.getUpdaterConfig();
        if (!config) {
            return ok({
                accepted: false,
                channel: XBOARD_UPDATE_CHANNEL,
                state: UPDATER_TRIGGER_STATES.UNCONFIGURED,
                operationId: null,
                message: 'Updater service is not configured',
            });
        }

        try {
            const response = await axios.post<unknown>(
                this.resolveUpdaterEndpoint(config.baseUrl, 'v1/update'),
                { channel: XBOARD_UPDATE_CHANNEL },
                {
                    ...this.getRequestConfig(config),
                    validateStatus: (status) => status === 200 || status === 202 || status === 409,
                },
            );
            const parsed = RemoteUpdaterTriggerSchema.safeParse(response.data);

            if (!parsed.success) {
                this.logger.warn('Updater trigger response did not match the configured contract');
                return ok({
                    accepted: false,
                    channel: XBOARD_UPDATE_CHANNEL,
                    state: UPDATER_TRIGGER_STATES.REJECTED,
                    operationId: null,
                    message: 'Updater returned an invalid trigger response',
                });
            }

            return ok({
                channel: XBOARD_UPDATE_CHANNEL,
                ...parsed.data,
            });
        } catch (error) {
            this.logRequestFailure('trigger request', error);

            if (axios.isAxiosError(error) && error.response) {
                return ok({
                    accepted: false,
                    channel: XBOARD_UPDATE_CHANNEL,
                    state: UPDATER_TRIGGER_STATES.REJECTED,
                    operationId: null,
                    message: `Updater rejected the request (HTTP ${error.response.status})`,
                });
            }

            return ok({
                accepted: false,
                channel: XBOARD_UPDATE_CHANNEL,
                state: UPDATER_TRIGGER_STATES.UNREACHABLE,
                operationId: null,
                message: 'Updater service is unreachable',
            });
        }
    }

    private getUpdaterConfig(): UpdaterConfig | null {
        const baseUrl = this.configService.get('UPDATER_URL');
        const secret = this.configService.get('UPDATER_SECRET');

        if (!baseUrl || !secret) {
            return null;
        }

        return {
            baseUrl,
            secret,
            timeoutMs: this.configService.getOrThrow('UPDATER_TIMEOUT_MS'),
        };
    }

    private getRequestConfig(config: UpdaterConfig): AxiosRequestConfig {
        return {
            timeout: config.timeoutMs,
            headers: {
                Accept: 'application/json',
                [UPDATER_SECRET_HEADER]: config.secret,
            },
            maxRedirects: 0,
            maxContentLength: MAX_UPDATER_RESPONSE_BYTES,
            maxBodyLength: MAX_UPDATER_RESPONSE_BYTES,
            proxy: false,
        };
    }

    private resolveUpdaterEndpoint(baseUrl: string, path: string): string {
        const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
        return new URL(path, normalizedBaseUrl).toString();
    }

    private failedStatus(lastError: string): UpdateStatus {
        return {
            configured: true,
            reachable: true,
            channel: XBOARD_UPDATE_CHANNEL,
            state: UPDATER_STATUS_STATES.FAILED,
            currentVersion: null,
            targetVersion: null,
            updateAvailable: null,
            lastError,
            updatedAt: null,
        };
    }

    private logRequestFailure(action: string, error: unknown): void {
        if (axios.isAxiosError(error)) {
            this.logger.warn(
                `Updater ${action} failed (code=${error.code ?? 'unknown'}, status=${error.response?.status ?? 'none'})`,
            );
            return;
        }

        this.logger.error(`Updater ${action} failed with an unexpected error`);
    }
}
