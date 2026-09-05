// Certificate-verified loopback relay inside the disposable Docker engine only.
import { readFile } from 'node:fs/promises';
import { request } from 'node:http';
import { createServer } from 'node:https';
createServer(
    { key: await readFile('/tls/key.pem'), cert: await readFile('/tls/cert.pem') },
    (incoming, outgoing) => {
        const upstream = request(
            {
                hostname: 'proxy',
                port: 8080,
                method: incoming.method,
                path: incoming.url,
                headers: incoming.headers,
                timeout: 120000,
            },
            (response) => {
                outgoing.writeHead(response.statusCode, response.headers);
                response.pipe(outgoing);
            },
        );
        upstream.once('error', () => {
            if (!outgoing.headersSent) outgoing.writeHead(502);
            outgoing.end();
        });
        upstream.once('timeout', () => upstream.destroy());
        incoming.once('aborted', () => upstream.destroy());
        outgoing.once('close', () => upstream.destroy());
        incoming.pipe(upstream);
    },
).listen(34445, '127.0.0.1');
