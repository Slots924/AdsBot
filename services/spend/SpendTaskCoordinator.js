export default class SpendTaskCoordinator {
    constructor({ spendService, backgroundTaskManager } = {}) {
        if (!spendService || !backgroundTaskManager) {
            throw new Error("Не передано залежності черги спенду");
        }
        this.spendService = spendService;
        this.backgroundTaskManager = backgroundTaskManager;
    }


    enqueueCollection() {
        return this.#enqueue({
            type: "spend-collect",
            name: "Оновлення спенду з Meta",
            uniqueKey: "spend-collect",
            operation: (context) => this.spendService.collect(context),
        });
    }


    enqueueExport() {
        return this.#enqueue({
            type: "spend-export-keitaro",
            name: "Передача спенду в Keitaro",
            uniqueKey: "spend-export-keitaro",
            operation: (context) => this.spendService.exportToKeitaro(context),
        });
    }


    async #enqueue({ type, name, uniqueKey, operation }) {
        const task = await this.backgroundTaskManager.enqueue({
            type,
            name,
            uniqueKey,
            resources: [{ key: "spend-database", label: "база спенду" }],
            input: {},
            metadata: { spendOperation: type },
            runner: async ({ signal, progress }) => {
                const result = await operation({ signal, progress });
                return {
                    result,
                    taskStatus: result.status === "success_with_warnings"
                        ? "completed_with_warnings"
                        : "completed",
                    reportDetails: {
                        inputSummary: { operation: type },
                        resultSummary: result,
                        warnings: result.warnings ?? [],
                    },
                };
            },
        });
        return { taskId: task.id, task };
    }
}
