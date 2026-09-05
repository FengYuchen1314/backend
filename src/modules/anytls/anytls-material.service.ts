import { X509Certificate } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { isScheduler } from '@common/utils/startup-app';

import { NodesQueuesService } from '@queue/_nodes';

import {
    AnyTlsMaterial,
    anyTlsClientIdentity,
    issueAnyTlsMaterial,
    validateAnyTlsMaterial,
} from './anytls-identity';
import { AnyTlsMaterialRepository } from './anytls-material.repository';

@Injectable()
export class AnyTlsMaterialService {
    private readonly logger = new Logger(AnyTlsMaterialService.name);
    constructor(
        private readonly repository: AnyTlsMaterialRepository,
        private readonly queues: NodesQueuesService,
    ) {}

    async ensure(inboundUuid: string, now = new Date()): Promise<AnyTlsMaterial> {
        for (let attempt = 0; attempt < 4; attempt++) {
            const current = await this.repository.read(inboundUuid);
            const previous = current
                ? validateAnyTlsMaterial(current.material, inboundUuid, now, false)
                : undefined;
            if (
                previous &&
                Date.parse(new X509Certificate(previous.tls.certificate).validTo) >
                    now.getTime() + 30 * 86400000
            )
                return validateAnyTlsMaterial(previous, inboundUuid, now);
            const next = await issueAnyTlsMaterial(inboundUuid, previous, now);
            if (await this.repository.save(inboundUuid, current?.revision ?? 0, next)) return next;
        }
        throw new Error(
            'Concurrent AnyTLS identity update; retry complete configuration reconciliation.',
        );
    }

    // Subscription reads cannot renew a leaf: renewal must queue reconciliation on every
    // physical server using this inbound, otherwise the database can hide an expired Agent.
    async clientIdentity(inboundUuid: string, now = new Date()) {
        const stored = await this.repository.read(inboundUuid);
        if (!stored) throw new Error('AnyTLS identity is not provisioned; start the node first.');
        return anyTlsClientIdentity(validateAnyTlsMaterial(stored.material, inboundUuid, now));
    }

    @Cron(CronExpression.EVERY_DAY_AT_3AM)
    async renewExpiringProfiles(): Promise<void> {
        if (!isScheduler()) return;
        try {
            for (const profileUuid of await this.repository.expiringProfiles(
                new Date(Date.now() + 30 * 86400000),
            ))
                await this.queues.startAllNodesByProfile({
                    profileUuid,
                    emitter: 'anyTlsCertificateRenewal',
                });
        } catch {
            this.logger.error('AnyTLS certificate renewal scheduling failed.');
        }
    }
}
