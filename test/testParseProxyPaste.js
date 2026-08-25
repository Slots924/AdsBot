import assert from "node:assert/strict";

import parseProxyPaste from "../services/proxy/parseProxyPaste.js";


const full = parseProxyPaste(
    "socks5://proxy.example.com:10000:demo-user:demo-pass[https://provider.example/changeip/token]"
);
assert.equal(full.ok, true);
assert.deepEqual(full, {
    ok: true,
    type: "socks5",
    host: "proxy.example.com",
    port: "10000",
    username: "demo-user",
    password: "demo-pass",
    refreshUrl: "https://provider.example/changeip/token",
});

const standard = parseProxyPaste("http://demo-user:demo-pass@proxy.example.com:8080");
assert.equal(standard.ok, true);
assert.equal(standard.type, "http");
assert.equal(standard.host, "proxy.example.com");
assert.equal(standard.port, "8080");
assert.equal(standard.username, "demo-user");
assert.equal(standard.password, "demo-pass");

const hostPort = parseProxyPaste("proxy.example.com:20000");
assert.equal(hostPort.ok, true);
assert.equal(hostPort.type, "");
assert.equal(hostPort.host, "proxy.example.com");
assert.equal(hostPort.port, "20000");

assert.equal(parseProxyPaste("").ok, false);
assert.equal(parseProxyPaste("only-host").ok, false);
assert.equal(parseProxyPaste("proxy.example.com:99999").ok, false);

console.log("Перевірка розбору рядка проксі пройшла успішно");
