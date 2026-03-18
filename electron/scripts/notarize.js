const { notarize } = require("@electron/notarize");

exports.default = async function notarizing(context) {
    const { electronPlatformName, appOutDir } = context;

    if (electronPlatformName !== "darwin") {
        return;
    }

    if (process.env.SKIP_NOTARIZE === "true") {
        console.log("Skipping notarization (SKIP_NOTARIZE=true).");
        return;
    }

    const appName = context.packager.appInfo.productFilename;
    const appPath = `${appOutDir}/${appName}.app`;

    console.log(`Notarizing ${appPath}...`);

    await notarize({
        appPath,
        tool: "notarytool",
        keychainProfile: "taskflow-notarize",
    });

    console.log("Notarization complete.");
};
