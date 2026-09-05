import { Crypto } from '@peculiar/webcrypto';
import {
    BasicConstraintsExtension,
    ExtendedKeyUsageExtension,
    KeyUsageFlags,
    KeyUsagesExtension,
    SubjectAlternativeNameExtension,
    X509Certificate as PeculiarCertificate,
    X509CertificateGenerator,
} from '@peculiar/x509';
import { createHmac, createPrivateKey, randomBytes, X509Certificate } from 'node:crypto';
import { z } from 'zod';

import { AnyTlsListenerSchema } from '@libs/contracts/models';

export const AnyTlsMaterialSchema = AnyTlsListenerSchema.pick({
    tls: true,
    wrapperPassword: true,
    shadowPassword: true,
})
    .extend({
        version: z.literal(1),
        caPrivateKey: z.string().min(64).max(16384),
    })
    .strict();
export type AnyTlsMaterial = z.infer<typeof AnyTlsMaterialSchema>;
const DAY = 86400000;
const algorithm = { name: 'ECDSA', namedCurve: 'P-256', hash: { name: 'SHA-256' } };

function pem(data: ArrayBuffer, label = 'PRIVATE KEY'): string {
    return `-----BEGIN ${label}-----\n${Buffer.from(data)
        .toString('base64')
        .match(/.{1,64}/g)!
        .join('\n')}\n-----END ${label}-----`;
}
function der(value: string): Uint8Array<ArrayBuffer> {
    return new Uint8Array(
        Buffer.from(value.replace(/-----[^-]+-----/g, '').replace(/\s/g, ''), 'base64'),
    );
}

export function anyTlsInnerServerName(inboundUuid: string): string {
    return `${z.uuid().parse(inboundUuid).toLowerCase()}.anytls.internal`;
}

export async function issueAnyTlsMaterial(
    inboundUuid: string,
    previous?: AnyTlsMaterial,
    now = new Date(),
): Promise<AnyTlsMaterial> {
    const crypto = new Crypto();
    const serverName = anyTlsInnerServerName(inboundUuid);
    const notBefore = new Date(now.getTime() - 5 * 60000);
    let caCertificate: string;
    let caPrivateKey: string;
    if (previous) {
        validateAnyTlsMaterial(previous, inboundUuid, now, false);
        caCertificate = previous.tls.caCertificate;
        caPrivateKey = previous.caPrivateKey;
    } else {
        const keys = await crypto.subtle.generateKey(algorithm, true, ['sign', 'verify']);
        const ca = await X509CertificateGenerator.createSelfSigned(
            {
                name: `CN=AnyTLS ${inboundUuid}`,
                serialNumber: randomBytes(16).toString('hex'),
                notBefore,
                notAfter: new Date(now.getTime() + 3650 * DAY),
                keys,
                signingAlgorithm: algorithm,
                extensions: [
                    new BasicConstraintsExtension(true, 0, true),
                    new KeyUsagesExtension(KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign, true),
                ],
            },
            crypto,
        );
        caCertificate = ca.toString('pem');
        caPrivateKey = pem(await crypto.subtle.exportKey('pkcs8', keys.privateKey));
    }
    const issuer = new PeculiarCertificate(caCertificate);
    const signingKey = await crypto.subtle.importKey('pkcs8', der(caPrivateKey), algorithm, false, [
        'sign',
    ]);
    const keys = await crypto.subtle.generateKey(algorithm, true, ['sign', 'verify']);
    const certificate = await X509CertificateGenerator.create(
        {
            subject: `CN=${serverName}`,
            issuer: issuer.subjectName,
            serialNumber: randomBytes(16).toString('hex'),
            notBefore,
            notAfter: new Date(now.getTime() + 90 * DAY),
            signingAlgorithm: algorithm,
            signingKey,
            publicKey: keys.publicKey,
            extensions: [
                new BasicConstraintsExtension(false, undefined, true),
                new KeyUsagesExtension(KeyUsageFlags.digitalSignature, true),
                new ExtendedKeyUsageExtension(['1.3.6.1.5.5.7.3.1'], true),
                new SubjectAlternativeNameExtension([{ type: 'dns', value: serverName }]),
            ],
        },
        crypto,
    );
    const material = AnyTlsMaterialSchema.parse({
        version: 1,
        caPrivateKey,
        wrapperPassword: previous?.wrapperPassword ?? randomBytes(32).toString('base64url'),
        shadowPassword: previous?.shadowPassword ?? randomBytes(32).toString('base64url'),
        tls: {
            serverName,
            caCertificate,
            certificate: certificate.toString('pem'),
            privateKey: pem(await crypto.subtle.exportKey('pkcs8', keys.privateKey)),
        },
    });
    validateAnyTlsMaterial(material, inboundUuid, now);
    return material;
}

export function validateAnyTlsMaterial(
    input: unknown,
    inboundUuid: string,
    now = new Date(),
    requireCurrentLeaf = true,
): AnyTlsMaterial {
    const material = AnyTlsMaterialSchema.parse(input);
    const ca = new X509Certificate(material.tls.caCertificate);
    const leaf = new X509Certificate(material.tls.certificate);
    const serverName = anyTlsInnerServerName(inboundUuid);
    if (
        !ca.ca ||
        !ca.verify(ca.publicKey) ||
        !ca.checkPrivateKey(createPrivateKey(material.caPrivateKey)) ||
        !leaf.checkPrivateKey(createPrivateKey(material.tls.privateKey)) ||
        !leaf.verify(ca.publicKey) ||
        leaf.ca ||
        material.tls.serverName !== serverName ||
        leaf.checkHost(serverName, { wildcards: false, subject: 'never' }) !== serverName ||
        !leaf.keyUsage?.includes('1.3.6.1.5.5.7.3.1') ||
        Date.parse(ca.validFrom) > now.getTime() ||
        Date.parse(ca.validTo) < now.getTime() + 91 * DAY ||
        (requireCurrentLeaf &&
            (Date.parse(leaf.validFrom) > now.getTime() ||
                Date.parse(leaf.validTo) <= now.getTime())) ||
        material.wrapperPassword === material.shadowPassword
    )
        throw new Error('Stored AnyTLS identity failed validation.');
    return material;
}

export function anyTlsClientIdentity(material: AnyTlsMaterial) {
    return {
        serverName: material.tls.serverName,
        caFingerprint: new X509Certificate(material.tls.caCertificate).fingerprint256
            .replaceAll(':', '')
            .toLowerCase(),
        wrapperPassword: material.wrapperPassword,
        shadowPassword: material.shadowPassword,
    };
}

export function deriveAnyTlsPassword(subscriberSecret: string, inboundUuid: string): string {
    if (!subscriberSecret) throw new Error('AnyTLS requires a subscriber credential.');
    return createHmac('sha256', subscriberSecret)
        .update(`xboard:anytls:v1:${z.uuid().parse(inboundUuid).toLowerCase()}`)
        .digest('base64url');
}
