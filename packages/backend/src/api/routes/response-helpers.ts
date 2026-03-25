function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function errorResponse(message: string, status: number): Response {
    return jsonResponse({ error: message }, status);
}

export { jsonResponse, errorResponse };
