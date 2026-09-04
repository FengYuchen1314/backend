export const TOPOLOGIES_CONTROLLER = 'topologies' as const;

const ACTIONS_ROUTE = 'actions' as const;

export const TOPOLOGIES_ROUTES = {
    GET_ALL: '',
    GET: (uuid: string) => `${uuid}`,
    CREATE: '',
    UPDATE: (uuid: string) => `${uuid}`,
    DELETE: (uuid: string) => `${uuid}`,
    ACTIONS: {
        VALIDATE: `${ACTIONS_ROUTE}/validate`,
        PREVIEW: `${ACTIONS_ROUTE}/preview`,
    },
} as const;
