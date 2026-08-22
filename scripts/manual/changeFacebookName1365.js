import { spawn } from "node:child_process";


const testProcess = spawn(
    process.execPath,
    [
        "scripts/manual/changeFacebookName.js",
        "--profiles=1365",
        ...process.argv.slice(2),
    ],
    {
        stdio: "inherit",
        windowsHide: false,
    }
);

testProcess.on("error", (error) => {
    console.error(
        "Не вдалося запустити тест профілю 1365:",
        error.message
    );
    process.exitCode = 1;
});

testProcess.on("exit", (code, signal) => {
    if (signal) {
        console.error(`Тест профілю 1365 зупинено сигналом ${signal}`);
        process.exitCode = 1;
        return;
    }

    process.exitCode = code ?? 1;
});
