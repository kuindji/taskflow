class BrowserHostUnavailableError extends Error {
    constructor() {
        super(
            "Browser not available on this machine: the Taskflow desktop app must be running here",
        );
        this.name = "BrowserHostUnavailableError";
    }
}

class BrowserTabInputError extends Error {}
class BrowserTabNotFoundError extends Error {}

export { BrowserHostUnavailableError, BrowserTabInputError, BrowserTabNotFoundError };
