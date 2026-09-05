export function resolvePlatformSource(source, index, arch) {
    if (!/^.+@sha256:[a-f0-9]{64}$/.test(source) || !['amd64', 'arm64'].includes(arch)) {
        throw new Error('A pinned image index and supported architecture are required');
    }
    const matches = (index.manifests ?? []).filter(
        (item) =>
            item.platform?.os === 'linux' &&
            item.platform.architecture === arch &&
            (!item.platform.variant || (arch === 'arm64' && item.platform.variant === 'v8')),
    );
    if (matches.length !== 1 || !/^sha256:[a-f0-9]{64}$/.test(matches[0].digest)) {
        throw new Error(`Expected exactly one Linux ${arch} manifest in the pinned index`);
    }
    return `${source.split('@')[0]}@${matches[0].digest}`;
}
