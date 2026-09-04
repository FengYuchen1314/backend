import z from 'zod';

export const TOPOLOGY_FORMATS = ['MIHOMO', 'SINGBOX', 'XRAY_JSON', 'XRAY_BASE64'] as const;
export const TOPOLOGY_LB_STRATEGIES = [
    'ROUND_ROBIN',
    'CONSISTENT_HASH',
    'URL_TEST',
    'SELECTOR',
] as const;

const TopologyPositionSchema = z
    .object({
        x: z.number().finite().min(-1_000_000).max(1_000_000),
        y: z.number().finite().min(-1_000_000).max(1_000_000),
    })
    .optional();

const TopologyBaseNodeSchema = z.object({
    id: z.uuid(),
    label: z.string().trim().min(1).max(64),
    position: TopologyPositionSchema,
});

export const TopologyGraphNodeSchema = z.discriminatedUnion('kind', [
    TopologyBaseNodeSchema.extend({
        kind: z.literal('ENTRY'),
    }),
    TopologyBaseNodeSchema.extend({
        kind: z.literal('PROXY'),
        hostUuid: z.uuid(),
        nodeUuid: z.uuid(),
    }),
    TopologyBaseNodeSchema.extend({
        kind: z.literal('LOAD_BALANCER'),
        strategy: z.enum(TOPOLOGY_LB_STRATEGIES),
        testUrl: z.url().startsWith('https://').optional(),
        intervalSeconds: z.int().min(10).max(86_400).optional(),
    }),
    TopologyBaseNodeSchema.extend({
        kind: z.literal('EXIT'),
    }),
]);

export const TopologyGraphEdgeSchema = z.object({
    id: z.uuid(),
    source: z.uuid(),
    target: z.uuid(),
    order: z.int().min(0).max(127).optional(),
});

export const TopologyGraphSchema = z.object({
    schemaVersion: z.literal(1),
    nodes: z.array(TopologyGraphNodeSchema).min(3).max(64),
    edges: z.array(TopologyGraphEdgeSchema).min(2).max(128),
});

export const TopologyIssueSchema = z.object({
    code: z.string(),
    message: z.string(),
    nodeIds: z.array(z.uuid()).optional(),
    edgeIds: z.array(z.uuid()).optional(),
});

export const TopologySchema = z.object({
    uuid: z.uuid(),
    name: z.string().min(2).max(100),
    version: z.int().positive(),
    isPublished: z.boolean().default(false),
    graph: TopologyGraphSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
});

export const TopologyValidationResultSchema = z.object({
    valid: z.boolean(),
    issues: z.array(TopologyIssueSchema),
    maxDepth: z.int().nonnegative(),
});

const SupportedPreviewSchema = z.object({
    format: z.enum(TOPOLOGY_FORMATS),
    status: z.literal('SUPPORTED'),
    artifact: z.record(z.string(), z.unknown()),
});

const UnsupportedPreviewSchema = z.object({
    format: z.enum(TOPOLOGY_FORMATS),
    status: z.literal('UNSUPPORTED'),
    reasonCode: z.string(),
    message: z.string(),
});

const ErrorPreviewSchema = z.object({
    format: z.enum(TOPOLOGY_FORMATS),
    status: z.literal('ERROR'),
    reasonCode: z.string(),
    message: z.string(),
});

export const TopologyPreviewResultSchema = z.discriminatedUnion('status', [
    SupportedPreviewSchema,
    UnsupportedPreviewSchema,
    ErrorPreviewSchema,
]);

export const TopologyPreviewResponseSchema = TopologyValidationResultSchema.extend({
    results: z.array(TopologyPreviewResultSchema),
});

export type TTopology = z.infer<typeof TopologySchema>;
export type TTopologyFormat = z.infer<typeof SupportedPreviewSchema>['format'];
export type TTopologyGraph = z.infer<typeof TopologyGraphSchema>;
export type TTopologyGraphNode = z.infer<typeof TopologyGraphNodeSchema>;
export type TTopologyIssue = z.infer<typeof TopologyIssueSchema>;
export type TTopologyPreviewResult = z.infer<typeof TopologyPreviewResultSchema>;
export type TTopologyValidationResult = z.infer<typeof TopologyValidationResultSchema>;
