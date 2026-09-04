export const XBOARD_UPDATE_CHANNEL = 'xboard-dev' as const;

export const UPDATER_STATUS_STATES = {
    UNCONFIGURED: 'UNCONFIGURED',
    UNREACHABLE: 'UNREACHABLE',
    IDLE: 'IDLE',
    UPDATING: 'UPDATING',
    SUCCEEDED: 'SUCCEEDED',
    FAILED: 'FAILED',
} as const;

export type TUpdaterStatusState =
    (typeof UPDATER_STATUS_STATES)[keyof typeof UPDATER_STATUS_STATES];

export const UPDATER_TRIGGER_STATES = {
    UNCONFIGURED: 'UNCONFIGURED',
    UNREACHABLE: 'UNREACHABLE',
    QUEUED: 'QUEUED',
    UPDATING: 'UPDATING',
    REJECTED: 'REJECTED',
} as const;

export type TUpdaterTriggerState =
    (typeof UPDATER_TRIGGER_STATES)[keyof typeof UPDATER_TRIGGER_STATES];
