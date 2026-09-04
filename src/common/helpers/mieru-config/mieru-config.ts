import {
    MieruProfileConfigSchema,
    TMieruProfileConfig,
} from '@libs/contracts/models/mieru-profile-config.schema';

export interface MieruInboundDefinition {
    tag: string;
    type: 'mieru';
    network: 'tcp' | 'udp';
    security: null;
    port: number;
    rawInbound: {
        protocol: 'mieru';
        settings: {
            handshakeMode: 'HANDSHAKE_STANDARD';
            loggingLevel: TMieruProfileConfig['loggingLevel'];
            metricsLoggingInterval: '1m';
            mtu: number;
            multiplexing: 'MULTIPLEXING_LOW';
            port: number;
            transport: 'TCP' | 'UDP';
            userHintIsMandatory: true;
        };
        tag: string;
    };
}

export function isMieruProfileConfig(value: unknown): boolean {
    return (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        (value as Record<string, unknown>).runtime === 'MIERU'
    );
}

export class MieruConfig {
    private readonly config: TMieruProfileConfig;

    constructor(value: unknown) {
        this.config = MieruProfileConfigSchema.parse(value);
    }

    public getConfig(): TMieruProfileConfig {
        return structuredClone(this.config);
    }

    public getAllInbounds(): MieruInboundDefinition[] {
        return this.config.listeners.map((listener) => ({
            tag: listener.tag,
            type: 'mieru',
            network: listener.protocol.toLowerCase() as 'tcp' | 'udp',
            security: null,
            port: listener.port,
            rawInbound: {
                protocol: 'mieru',
                tag: listener.tag,
                settings: {
                    port: listener.port,
                    transport: listener.protocol,
                    mtu: this.config.mtu,
                    multiplexing: this.config.multiplexing,
                    handshakeMode: this.config.handshakeMode,
                    userHintIsMandatory: this.config.userHintIsMandatory,
                    metricsLoggingInterval: this.config.metricsLoggingInterval,
                    loggingLevel: this.config.loggingLevel,
                },
            },
        }));
    }
}
