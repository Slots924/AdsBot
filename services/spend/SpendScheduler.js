function isDue(lastRunAt, intervalMinutes, now) {
    if (!lastRunAt) return true;
    const timestamp = new Date(lastRunAt).getTime();
    return !Number.isFinite(timestamp)
        || now.getTime() - timestamp >= intervalMinutes * 60_000;
}


export default class SpendScheduler {
    constructor({ store, coordinator, logger = null, intervalMs = 30_000 } = {}) {
        this.store = store;
        this.coordinator = coordinator;
        this.logger = logger;
        this.intervalMs = intervalMs;
        this.timer = null;
        this.checking = false;
        this.lastAttempts = new Map();
    }


    start() {
        if (this.timer) return;
        this.timer = setInterval(() => this.checkNow(), this.intervalMs);
        this.timer.unref?.();
        this.checkNow();
    }


    stop() {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }


    async checkNow() {
        if (this.checking) return;
        this.checking = true;
        try {
            const settings = this.store.getSettings();
            const now = new Date();
            const operations = [{
                key: "collect",
                enabled: settings.collectEnabled,
                lastRunAt: settings.lastCollectionRunAt,
                intervalMinutes: settings.collectIntervalMinutes,
                enqueue: () => this.coordinator.enqueueCollection(),
            }, {
                key: "export",
                enabled: settings.exportEnabled,
                lastRunAt: settings.lastExportRunAt,
                intervalMinutes: settings.exportIntervalMinutes,
                enqueue: () => this.coordinator.enqueueExport(),
            }];
            for (const operation of operations) {
                const lastAttempt = this.lastAttempts.get(operation.key);
                const retryMinutes = Math.min(operation.intervalMinutes, 15);
                if (
                    !operation.enabled
                    || !isDue(operation.lastRunAt, operation.intervalMinutes, now)
                    || (lastAttempt && !isDue(lastAttempt, retryMinutes, now))
                ) continue;
                this.lastAttempts.set(operation.key, now.toISOString());
                try {
                    await operation.enqueue();
                } catch (error) {
                    if (error?.code !== "BACKGROUND_TASK_ALREADY_QUEUED") {
                        this.logger?.warn(
                            "spend.scheduler.operation-failed",
                            `Не вдалося запланувати задачу ${operation.key}`,
                            { error }
                        );
                    }
                }
            }
        } catch (error) {
            if (error?.code !== "BACKGROUND_TASK_ALREADY_QUEUED") {
                this.logger?.warn("spend.scheduler.failed", "Не вдалося запланувати оновлення спенду", { error });
            }
        } finally {
            this.checking = false;
        }
    }
}


export { isDue };
