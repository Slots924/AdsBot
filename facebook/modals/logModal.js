export default function logModal(logger, message, extra = null) {
    const text = extra
        ? `[modal] ${message} ${JSON.stringify(extra)}`
        : `[modal] ${message}`;
    console.log(text);

    try {
        if (typeof logger?.info === "function") {
            if (typeof logger.child === "function") {
                logger.info("facebook.modal", message, extra ?? {});
            } else {
                logger.info(text);
            }
        }
    } catch {
        // Лог не повинен зупиняти обробку модалки.
    }
}
