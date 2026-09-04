import { createHmac } from 'node:crypto';

const SOCKS_PASSWORD_DOMAIN = 'remnawave:socks-password:v1\0';

export function deriveSocksPassword(trojanPassword: string, vlessUuid: string): string {
    return createHmac('sha256', `${trojanPassword}\0${vlessUuid}`)
        .update(SOCKS_PASSWORD_DOMAIN, 'utf8')
        .digest('base64url');
}

export function getSocksUserHashIdentity(username: string, password: string): string {
    return `${username}\0${password}`;
}
