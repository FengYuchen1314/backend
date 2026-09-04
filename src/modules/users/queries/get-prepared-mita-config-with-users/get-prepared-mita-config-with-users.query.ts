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

export class GetPreparedMitaConfigWithUsersQuery extends Query<TResult<IMitaServerConfig>> {
    constructor(public readonly activeInbounds: ConfigProfileInboundEntity[]) {
        super();
    }
}
