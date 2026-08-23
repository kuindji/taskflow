function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isJsonParseError(error: unknown): error is SyntaxError {
    return error instanceof SyntaxError;
}

export { isMissingFileError, isJsonParseError };
