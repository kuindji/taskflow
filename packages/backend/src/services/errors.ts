class NotFoundError extends Error {}

/** The request is valid but the records it touches are not in a state that allows it. */
class ConflictError extends Error {}

export { ConflictError, NotFoundError };
