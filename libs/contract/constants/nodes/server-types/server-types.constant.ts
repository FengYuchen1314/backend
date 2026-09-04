export const SERVER_TYPES = {
    PUBLIC_DIRECT: 'PUBLIC_DIRECT',
    LEASED_LINE: 'LEASED_LINE',
    BROADBAND_LANDING: 'BROADBAND_LANDING',
} as const;

export type TServerType = (typeof SERVER_TYPES)[keyof typeof SERVER_TYPES];
export const SERVER_TYPES_VALUES = Object.values(SERVER_TYPES);
