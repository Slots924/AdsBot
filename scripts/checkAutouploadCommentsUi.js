import { createServer } from "../frontend/node_modules/vite/dist/node/index.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import path from "node:path";

// Ізольований стенд перевіряє справжню вкладку з вигаданими акаунтами, без робочого IPC.
const fixture = `import React from 'react'; import {createRoot} from 'react-dom/client';
import AutouploadTab from '/src/tabs/AutouploadTab.jsx';
import '/src/styles/shared-ui.css'; import '/src/styles/app.css';
const state={groups:[{id:'new',name:'Нові'}],profiles:Array.from({length:6},(_,i)=>({profileId:'p'+i,profileNo:String(2238+i),name:['Sofia Martin','Anna Keller','Emma Wilson','Mia Becker','Laura Fischer','Olivia Brown'][i],groupId:'new',status:'active'})),history:[]};
window.adsBot={getAutoupload:async()=>({ok:true,data:state}),onAutouploadUpdated:()=>()=>{},publishAutouploadComments:async(ids,input)=>{window.submitted={ids,input};return {ok:true,data:{taskId:'demo-task'}}}};
createRoot(document.getElementById('root')).render(<div style={{padding:24}}><AutouploadTab showToast={message=>{document.body.dataset.toast=message}} /></div>);`;
const server = await createServer({ root: path.resolve("frontend"), server: { host: "127.0.0.1", port: 0, open: false },
    plugins: [{ name: "comments-preview", enforce: "pre",
        resolveId(id) { if (id === "/__comments-preview.jsx") return path.resolve("frontend/__comments-preview.jsx"); },
        load(id) { if (id.endsWith("/__comments-preview.jsx") || id.endsWith("\\__comments-preview.jsx")) return fixture; },
        configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
            if (req.url !== "/__comments-preview") return next();
            res.setHeader("Content-Type", "text/html");
            res.end(await vite.transformIndexHtml(req.url, '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/__comments-preview.jsx"></script></body></html>'));
        }); },
    }],
});
try {
    await server.listen();
    const require = createRequire(path.resolve("frontend/package.json"));
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const result = await promisify(execFile)(require("electron"), [path.resolve("frontend/electron/reviewAutouploadComments.cjs"), `http://127.0.0.1:${server.httpServer.address().port}/__comments-preview`], { env, windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 });
    console.log(result.stdout.trim());
} finally { await server.close(); }
