# Camouflage-domain Node Agent contract

The Panel never validates a camouflage domain from the Panel host. It sends the following request
over the existing authenticated Panel-to-Node connection to the selected Node Agent.

## Endpoint

`POST /node/camouflage-domain/validate`

## Request JSON

```json
{
  "domain": "lax-ca-us-ping.vultr.com",
  "expectedRegion": "LOS_ANGELES",
  "requirements": {
    "tlsVersion": "TLSv1.3",
    "httpProtocol": "h2",
    "keyExchangeGroup": "X25519",
    "minimumCertificateValidityDays": 14,
    "maximumRedirects": 0,
    "minimumDistinctMainlandProbeAsns": 2,
    "maximumMainlandEvidenceAgeHours": 24,
    "rejectCloudflare": true,
    "requireCertificateSanMatch": true
  }
}
```

`expectedRegion` is one of `LOS_ANGELES`, `SAN_JOSE`, `TOKYO`, `SINGAPORE`, `FRANKFURT`,
`LONDON`, or `AMSTERDAM`. The request is strict: extra properties are rejected by the shared Zod
schema in `libs/contract/models/camouflage-domain.schema.ts`.

## Response JSON

```json
{
  "response": {
    "domain": "lax-ca-us-ping.vultr.com",
    "expectedRegion": "LOS_ANGELES",
    "checkedAt": "2026-09-04T12:30:00.000Z",
    "dns": {
      "addresses": ["203.0.113.10"],
      "cnameChain": [],
      "fingerprint": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "containsBogon": false
    },
    "edge": {
      "provider": "Vultr",
      "asn": "AS20473",
      "observedRegion": null
    },
    "cloudflare": {
      "detected": false,
      "signals": []
    },
    "tls": {
      "version": "TLSv1.3",
      "cipherSuite": "TLS_AES_128_GCM_SHA256",
      "keyExchangeGroup": "X25519",
      "certificate": {
        "sans": ["lax-ca-us-ping.vultr.com"],
        "sanMatches": true,
        "notBefore": "2026-08-01T00:00:00.000Z",
        "notAfter": "2026-11-01T00:00:00.000Z"
      }
    },
    "http": {
      "negotiatedProtocol": "h2",
      "statusCode": 200,
      "redirectCount": 0,
      "serverHeader": null,
      "locationHeader": null
    },
    "mainlandProbes": [
      {
        "probeId": "cn-telecom-1",
        "countryCode": "CN",
        "asn": "AS4134",
        "reachable": true,
        "checkedAt": "2026-09-04T12:29:00.000Z"
      },
      {
        "probeId": "cn-unicom-1",
        "countryCode": "CN",
        "asn": "AS4837",
        "reachable": true,
        "checkedAt": "2026-09-04T12:29:10.000Z"
      }
    ]
  }
}
```

The Agent must compute `dns.fingerprint` as lowercase SHA-256 over a deterministic encoding of the
normalized domain, sorted A/AAAA addresses, ordered CNAME chain, and observed edge ASN (or the
literal `unknown` when no trustworthy IP-to-ASN source exists). DNS, CNAME, or ASN changes therefore
create a different cache identity. `edge.provider`, `edge.asn`, and `edge.observedRegion` must be
`null` rather than guessed. A 3xx response or any `Location` header counts as a redirect even though
the Agent never follows it. The Panel validates the full response again and derives eligibility
itself; an Agent-provided eligibility flag is intentionally not accepted.

`mainlandProbes` accepts only evidence from a configured, authenticated mainland probe system. A
standalone Node Agent must return an empty array; it must not claim that its own overseas request is
mainland reachability evidence. The Panel then fails closed and asks the operator for a verified
domain.
