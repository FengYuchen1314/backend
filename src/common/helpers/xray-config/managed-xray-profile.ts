import { AnyTlsProfileExtensionSchema, TAnyTlsProfileExtension } from '@libs/contracts/models';

import {
    isCloudflareCdnAddress,
    isCloudflareCdnHostname,
} from '@modules/nodes/camouflage-domain/cloudflare-ip-ranges';

import { XRayConfig } from './xray-config.validator';

export interface AnyTlsInboundDefinition {
    tag: string;
    type: 'anytls';
    network: 'tcp';
    security: 'tls';
    port: 443;
    rawInbound: {
        protocol: 'anytls';
        tag: string;
        settings: TAnyTlsProfileExtension['listeners'][number];
    };
}

// Keep native Xray configuration at the original root and attach only one namespaced panel
// extension. Never send that extension to Xray or interpret synthetic AnyTLS inbounds as Xray.
export class ManagedXrayProfile {
    readonly xray: XRayConfig;
    readonly anyTls: TAnyTlsProfileExtension | undefined;

    constructor(input: object) {
        const native = structuredClone(input) as Record<string, unknown>;
        if (Object.hasOwn(native, 'xboardAnyTls')) {
            this.anyTls = AnyTlsProfileExtensionSchema.parse(native.xboardAnyTls);
            delete native.xboardAnyTls;
        }
        this.xray = new XRayConfig(native, { allowEmptyInbounds: !!this.anyTls?.listeners.length });
        const inbounds = this.xray.getConfig().inbounds ?? [];
        const tags = new Set(inbounds.map((inbound) => inbound.tag));
        const snis = new Set(
            inbounds
                .flatMap((inbound) => inbound.streamSettings?.realitySettings?.serverNames ?? [])
                .map((name) => name.toLowerCase()),
        );
        for (const listener of this.anyTls?.listeners ?? []) {
            if (tags.has(listener.tag)) throw new Error('Xray and AnyTLS tags must be unique.');
            if (snis.has(listener.camouflage.serverName))
                throw new Error('Xray and AnyTLS camouflage SNI must be unique.');
            if (
                isCloudflareCdnHostname(listener.camouflage.serverName) ||
                isCloudflareCdnAddress(listener.camouflage.address)
            )
                throw new Error('Cloudflare CDN camouflage is forbidden.');
            for (const inbound of inbounds) {
                const port = inbound.port;
                if (typeof port !== 'number' && typeof port !== 'string')
                    throw new Error('Mixed profiles require explicit Xray ports.');
                for (const part of String(port).split(',')) {
                    const match = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
                    const from = Number(match?.[1]);
                    const to = Number(match?.[2] ?? match?.[1]);
                    if (!match || from < 1 || to > 65535 || from > to)
                        throw new Error('Invalid Xray port range in mixed profile.');
                    if (
                        [listener.wrapperPort, listener.innerPort].some(
                            (value) => value >= from && value <= to,
                        )
                    )
                        throw new Error('Xray and AnyTLS private ports overlap.');
                }
            }
        }
    }

    getSortedConfig(): object {
        return {
            ...this.xray.getSortedConfig(),
            ...(this.anyTls ? { xboardAnyTls: structuredClone(this.anyTls) } : {}),
        };
    }

    getAllInbounds() {
        const anyTls: AnyTlsInboundDefinition[] = (this.anyTls?.listeners ?? []).map(
            (listener) => ({
                tag: listener.tag,
                type: 'anytls',
                network: 'tcp',
                security: 'tls',
                port: 443,
                rawInbound: {
                    protocol: 'anytls',
                    tag: listener.tag,
                    settings: structuredClone(listener),
                },
            }),
        );
        return [...this.xray.getAllInbounds(), ...anyTls];
    }
}
