export const NODE_CREATION_MODES = {
    MANAGED: 'MANAGED',
    EXTERNAL_IMPORT: 'EXTERNAL_IMPORT',
} as const;

export type TNodeCreationMode = (typeof NODE_CREATION_MODES)[keyof typeof NODE_CREATION_MODES];
