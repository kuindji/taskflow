export function postBodyHeaders(
    body: { contentType: string; boundary?: string } | undefined,
): string | undefined {
    if (!body) return undefined;
    return `content-type: ${body.contentType}${body.boundary ? `; boundary=${body.boundary}` : ""}`;
}
