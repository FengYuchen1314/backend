import { TTopology, TTopologyGraph } from '@libs/contracts/models';

export type TopologyRecord = TTopology;

export interface TopologyReferenceHost {
    activeInboundNodeUuids: ReadonlySet<string>;
    nodeUuids: ReadonlySet<string>;
}

export interface TopologyReferenceSnapshot {
    hosts: ReadonlyMap<string, TopologyReferenceHost>;
    nodeUuids: ReadonlySet<string>;
}

export interface StoredTopologyEnvelope {
    graph: TTopologyGraph;
    kind: 'XBOARD_TOPOLOGY';
    schemaVersion: 1;
    version: number;
}
