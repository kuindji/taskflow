function parseVersion(value: string): [number, number, number] | null {
    const match = value.match(/(?:^|\s|v)(\d+)\.(\d+)\.(\d+)/);
    if (!match) return null;
    return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isVersionAtLeast(value: string, minimum: [number, number, number]): boolean {
    const parsed = parseVersion(value);
    if (!parsed) return false;
    for (let index = 0; index < minimum.length; index += 1) {
        if (parsed[index] > minimum[index]) return true;
        if (parsed[index] < minimum[index]) return false;
    }
    return true;
}

export { parseVersion, isVersionAtLeast };
