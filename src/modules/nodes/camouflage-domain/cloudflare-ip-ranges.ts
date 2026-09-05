import { BlockList, isIP } from 'node:net';

// Independent panel check: do not rely solely on an Agent's detected/provider flag.
// Rechecked 2026-09-05 against https://www.cloudflare.com/ips-v4/ and /ips-v6/.
const ranges = new BlockList();
for (const cidr of [
    '173.245.48.0/20',
    '103.21.244.0/22',
    '103.22.200.0/22',
    '103.31.4.0/22',
    '141.101.64.0/18',
    '108.162.192.0/18',
    '190.93.240.0/20',
    '188.114.96.0/20',
    '197.234.240.0/22',
    '198.41.128.0/17',
    '162.158.0.0/15',
    '104.16.0.0/13',
    '104.24.0.0/14',
    '172.64.0.0/13',
    '131.0.72.0/22',
    '2400:cb00::/32',
    '2606:4700::/32',
    '2803:f800::/32',
    '2405:b500::/32',
    '2405:8100::/32',
    '2a06:98c0::/29',
    '2c0f:f248::/32',
]) {
    const [ip, prefix] = cidr.split('/');
    ranges.addSubnet(ip, Number(prefix), isIP(ip) === 4 ? 'ipv4' : 'ipv6');
}

export function isCloudflareCdnAddress(address: string): boolean {
    const family = isIP(address);
    return family !== 0 && ranges.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

// Match the Agent and standalone discovery policy, without mistaking a DNS-only nameserver
// choice or an unrelated hostname containing "cloudflare" for CDN use.
export function isCloudflareCdnHostname(hostname: string): boolean {
    return /(^|\.)(?:cloudflare\.(?:com|net)|cloudflare-dns\.com|pages\.dev|workers\.dev|r2\.dev)\.?$/i.test(
        hostname,
    );
}
