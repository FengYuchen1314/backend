import { Query } from '@nestjs/cqrs';

import { TResult } from '@common/types';

import { ConfigProfileInboundEntity } from '@modules/config-profiles/entities';

export interface IMitaServerConfig {
    portBindings: Array<{
        port: number;
        protocol: 'TCP' | 'UDP';
    }>;
    users: Array<{
        name: string;
        password: string;
    }>;
    advancedSettings: {
        metricsLoggingInterval: '1m';
        userHintIsMandatory: true;
    };
    loggingLevel: 'FATAL' | 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'TRACE';
    mtu: number;
}

export interface IMitaRuntimeConfig {
    kind: 'ISOLATED_LISTENERS';
    instances: Array<{ id: string; config: IMitaServerConfig }>;
}

export class GetPreparedMitaConfigWithUsersQuery extends Query<TResult<IMitaRuntimeConfig>> {
    constructor(public readonly activeInbounds: ConfigProfileInboundEntity[]) {
        super();
    }
}
