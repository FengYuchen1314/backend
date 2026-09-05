import { Injectable, Logger } from '@nestjs/common';

import { AxiosService } from '@common/axios';
import { TypedConfigService } from '@common/config/app-config';
import { EVENTS } from '@libs/contracts/constants';

import { IRecordUserUsagePayload } from '@queue/_nodes/interfaces';
import { UsersQueuesService } from '@queue/_users';

import { AnyTlsUsageRepository } from './anytls-usage.repository';

@Injectable()
export class AnyTlsUsageService {
    private readonly logger = new Logger(AnyTlsUsageService.name);
    constructor(
        private readonly axios: AxiosService,
        private readonly repository: AnyTlsUsageRepository,
        private readonly config: TypedConfigService,
        private readonly usersQueues: UsersQueuesService,
    ) {}

    async poll(payload: IRecordUserUsagePayload): Promise<string[]> {
        const result = await this.axios.getAnyTlsUsage(payload.connectionOpts);
        if (!result.isOk)
            throw new Error('AnyTLS cumulative usage could not be fetched or validated.');
        if (!result.response.available) return [];
        const saved = await this.repository.record(result.response, {
            nodeUuid: payload.nodeUuid,
            nodeId: BigInt(payload.nodeId),
            consumptionMultiplier: payload.consumptionMultiplier,
            ignoreBelowBytes: this.config.getOrThrow('USER_USAGE_IGNORE_BELOW_BYTES'),
            recordHistory: !this.config.getOrThrow('SERVICE_DISABLE_USER_USAGE_RECORDS'),
        });
        // User traffic and firstConnectedAt are already committed. Notification
        // delivery is best effort, as in the existing native-accounting pipeline.
        if (saved.firstConnected.length)
            try {
                await this.usersQueues.fireUserEventBulk({
                    users: saved.firstConnected,
                    userEvent: EVENTS.USER.FIRST_CONNECTED,
                });
            } catch {
                this.logger.error(
                    'AnyTLS first-connection notification could not be queued. Usage remains committed.',
                );
            }
        return saved.onlineUsers;
    }
}
