export class FilePreviewError extends Error {
    constructor(readonly state: "tooLarge" | "binary") {
        super(
            state === "tooLarge"
                ? "File preview exceeds 5 MiB"
                : "Binary file preview is unavailable",
        );
        this.name = "FilePreviewError";
    }
}
