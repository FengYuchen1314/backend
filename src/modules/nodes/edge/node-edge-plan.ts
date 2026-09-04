import {
    CamouflageDomainSchema,
    NODE_EDGE_PLAN_VERSION,
    NodeEdgePlanSchema,
    NodeEdgeSettingsSchema,
    TNodeEdgePlan,
    TNodeEdgeSettings,
} from '@contract/models';
import { createHash } from 'node:crypto';

import { ConfigProfileInboundEntity } from '@modules/config-profiles/entities';

const INTERNAL_PORT_MIN = 12_000;
const INTERNAL_PORT_MAX = 12_999;
const RESERVED_INTERNAL_PORTS = new Set([80, 18_080, 18_443, 2_019]);

type JsonRecord = Record<string, unknown>;

export interface IPreparedNodeEdge {
    config: JsonRecord;
    fingerprint: string;
    plan: TNodeEdgePlan;
    settings: TNodeEdgeSettings;
}

export function prepareNodeEdge(
    inputConfig: JsonRecord,
    activeInbounds: readonly ConfigProfileInboundEntity[],
    settingsInput: unknown,
    publicNodeAddress?: string,
): IPreparedNodeEdge {
    const settings = NodeEdgeSettingsSchema.parse(settingsInput ?? {});
    assertNoPublicListenerSelfLoop(settings, publicNodeAddress);
    const config = structuredClone(inputConfig);
    const inbounds = getRecordArray(config.inbounds, 'Xray config inbounds');
    const configInboundByTag = new Map<string, JsonRecord>();

    for (const inbound of inbounds) {
        const tag = readString(inbound.tag, 'Xray inbound tag');
        if (configInboundByTag.has(tag)) {
            throw new Error(`Xray config contains duplicate inbound tag ${tag}.`);
        }
        configInboundByTag.set(tag, inbound);
    }

    const occupiedPorts = new Set<number>(RESERVED_INTERNAL_PORTS);
    for (const inbound of inbounds) {
        const ports = readPorts(inbound.port);
        if (ports.includes(443) && ports.length !== 1) {
            throw new Error(
                `Inbound ${inbound.tag} must use a single port to share public port 443.`,
            );
        }
        for (const port of ports) {
            if (RESERVED_INTERNAL_PORTS.has(port)) {
                throw new Error(`Inbound ${inbound.tag} uses reserved edge port ${port}.`);
            }
            if (port !== 443) occupiedPorts.add(port);
        }
    }

    const tagBySni = new Map<string, string>();
    const rewrittenTags = new Set<string>();
    const routes: TNodeEdgePlan['routes'] = [];

    for (const activeInbound of [...activeInbounds].sort(compareActiveInbounds)) {
        const configInbound = configInboundByTag.get(activeInbound.tag);
        if (!configInbound) {
            throw new Error(`Active inbound ${activeInbound.tag} is missing from prepared config.`);
        }

        const publicPort = readPorts(configInbound.port)[0];
        if (publicPort !== 443) continue;

        const protocol = readString(
            configInbound.protocol,
            `${activeInbound.tag} protocol`,
        ).toLowerCase();
        const streamSettings = readRecord(
            configInbound.streamSettings,
            `${activeInbound.tag} streamSettings`,
        );
        const security = readString(
            streamSettings.security,
            `${activeInbound.tag} security`,
        ).toLowerCase();
        const network = readString(
            streamSettings.network,
            `${activeInbound.tag} network`,
        ).toLowerCase();

        if (
            protocol !== 'vless' ||
            security !== 'reality' ||
            !['raw', 'tcp', 'xhttp'].includes(network)
        ) {
            throw new Error(
                `Inbound ${activeInbound.tag} cannot share public port 443. Only managed VLESS REALITY raw/TCP or XHTTP is supported.`,
            );
        }

        const realitySettings = readRecord(
            streamSettings.realitySettings,
            `${activeInbound.tag} realitySettings`,
        );
        const serverNames = normalizeServerNames(realitySettings.serverNames, activeInbound.tag);
        const internalPort = allocateInternalPort(activeInbound, occupiedPorts);
        occupiedPorts.add(internalPort);

        configInbound.listen = '127.0.0.1';
        configInbound.port = internalPort;
        rewrittenTags.add(activeInbound.tag);
        realitySettings.serverNames = serverNames;
        const sockopt = readOptionalRecord(streamSettings.sockopt) ?? {};
        sockopt.acceptProxyProtocol = true;
        streamSettings.sockopt = sockopt;

        for (const sni of serverNames) {
            const existingTag = tagBySni.get(sni);
            if (existingTag && existingTag !== activeInbound.tag) {
                throw new Error(
                    `Camouflage domain ${sni} is already assigned to inbound ${existingTag}. Every inbound on one server needs a unique SNI.`,
                );
            }
            if (existingTag) continue;

            tagBySni.set(sni, activeInbound.tag);
            routes.push({
                sni,
                targetHost: '127.0.0.1',
                targetPort: internalPort,
                sendProxyV2: true,
                inboundTag: activeInbound.tag,
            });
        }
    }

    for (const inbound of inbounds) {
        if (readPorts(inbound.port).includes(443)) {
            const tag = readString(inbound.tag, 'Xray inbound tag');
            if (!rewrittenTags.has(tag)) {
                throw new Error(
                    `Inbound ${tag} still owns public port 443 after edge planning. Only active managed VLESS REALITY inbounds may use the shared listener.`,
                );
            }
        }
    }

    const plan = NodeEdgePlanSchema.parse({
        version: NODE_EDGE_PLAN_VERSION,
        publicHttpPort: 80,
        publicHttpsPort: 443,
        caddyHttpTarget: '127.0.0.1:18080',
        caddyHttpsTarget: '127.0.0.1:18443',
        routes: routes.sort(
            (left, right) =>
                left.sni.localeCompare(right.sni) ||
                left.inboundTag.localeCompare(right.inboundTag),
        ),
        management: settings.management,
        website: settings.website,
    });
    const fingerprint = createHash('sha256').update(JSON.stringify(plan)).digest('hex');

    return { config, fingerprint, plan, settings };
}

function normalizeServerNames(value: unknown, inboundTag: string): string[] {
    if (!Array.isArray(value) || value.length === 0 || value.length > 32) {
        throw new Error(`Inbound ${inboundTag} must have between 1 and 32 REALITY server names.`);
    }

    const result: string[] = [];
    const unique = new Set<string>();
    for (const item of value) {
        if (typeof item !== 'string') {
            throw new Error(`Inbound ${inboundTag} has an invalid REALITY server name.`);
        }
        const parsed = CamouflageDomainSchema.safeParse(item);
        if (!parsed.success) {
            throw new Error(
                `Inbound ${inboundTag} REALITY server name ${JSON.stringify(item)} must be an exact DNS name. Wildcards and IP addresses cannot be routed safely on shared port 443.`,
            );
        }
        if (!unique.has(parsed.data)) {
            unique.add(parsed.data);
            result.push(parsed.data);
        }
    }
    return result.sort();
}

function assertNoPublicListenerSelfLoop(
    settings: TNodeEdgeSettings,
    publicNodeAddress: string | undefined,
): void {
    const normalizedNodeAddress = publicNodeAddress
        ?.trim()
        .toLowerCase()
        .replace(/^\[|\]$/g, '')
        .replace(/\.$/, '');
    if (!normalizedNodeAddress) return;

    for (const [role, site] of [
        ['management', settings.management],
        ['website', settings.website],
    ] as const) {
        if (!site) continue;
        const upstream = new URL(site.upstream);
        const upstreamPort = Number(upstream.port || (upstream.protocol === 'https:' ? 443 : 80));
        if (
            upstream.hostname
                .toLowerCase()
                .replace(/^\[|\]$/g, '')
                .replace(/\.$/, '') === normalizedNodeAddress &&
            (upstreamPort === 80 || upstreamPort === 443)
        ) {
            throw new Error(
                `The ${role} upstream points back to this node's public ${upstreamPort} listener and would create a reverse-proxy loop.`,
            );
        }
    }
}

function allocateInternalPort(
    inbound: ConfigProfileInboundEntity,
    occupiedPorts: ReadonlySet<number>,
): number {
    const identity = inbound.uuid || inbound.tag;
    const digest = createHash('sha256').update(identity).digest();
    const range = INTERNAL_PORT_MAX - INTERNAL_PORT_MIN + 1;
    const offset = digest.readUInt32BE(0) % range;

    for (let step = 0; step < range; step += 1) {
        const candidate = INTERNAL_PORT_MIN + ((offset + step) % range);
        if (!occupiedPorts.has(candidate)) return candidate;
    }
    throw new Error('No internal port is available for shared-443 routing.');
}

function compareActiveInbounds(
    left: ConfigProfileInboundEntity,
    right: ConfigProfileInboundEntity,
): number {
    return (left.uuid || left.tag).localeCompare(right.uuid || right.tag);
}

function getRecordArray(value: unknown, label: string): JsonRecord[] {
    if (!Array.isArray(value) || !value.every((item) => isRecord(item))) {
        throw new Error(`${label} must be an array of objects.`);
    }
    return value;
}

function readRecord(value: unknown, label: string): JsonRecord {
    if (!isRecord(value)) throw new Error(`${label} must be an object.`);
    return value;
}

function readOptionalRecord(value: unknown): JsonRecord | null {
    return isRecord(value) ? value : null;
}

function readString(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`${label} must be a non-empty string.`);
    }
    return value;
}

function readPorts(value: unknown): number[] {
    // Xray also accepts numeric strings, lists and ranges. Reserve every port,
    // not only the first one, before assigning internal listeners.
    if (value === undefined || value === null) return [];
    const result: number[] = [];
    const expression = typeof value === 'number' ? String(value) : value;
    if (typeof expression !== 'string') throw new Error('Invalid inbound port.');
    for (const item of expression.split(',')) {
        const match = /^(\d+)(?:-(\d+))?$/.exec(item.trim());
        if (!match) throw new Error('Invalid inbound port expression.');
        const from = Number(match[1]);
        const to = Number(match[2] ?? match[1]);
        if (from < 1 || to > 65_535 || from > to) throw new Error('Invalid inbound port range.');
        for (let port = from; port <= to; port++) result.push(port);
    }
    return result;
}

function isRecord(value: unknown): value is JsonRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
