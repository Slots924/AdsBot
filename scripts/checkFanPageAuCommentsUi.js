import { createServer } from "../frontend/node_modules/vite/dist/node/index.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import path from "node:path";

// Перевірка реального переходу з модального вікна фанпейджі на вигаданих даних.
const fixture = `import React from 'react'; import {createRoot} from 'react-dom/client';
import {CommentModal} from '/src/tabs/PagesTab.jsx';
import '/src/styles/shared-ui.css'; import '/src/styles/app.css';
const profiles=Array.from({length:12},(_,i)=>({profileId:'p'+i,profileNo:String(100+i),name:['Олена Тестова','Іван Тестовий'][i%2],gender:i%2?'male':'female'}));
window.adsBot={prepareFanPageAuComments:async(input)=>{window.preparedInput=input;return {ok:true,data:{profiles,prepared:{commentRows:[{id:'1',parent_id:null,profile_key:'a',text:'Перший тестовий коментар до поста',gender:'female'},{id:'2',parent_id:'1',profile_key:'b',text:'Реплай другого учасника із посиланням https://example.com',gender:'male'},{id:'3',parent_id:'2',profile_key:'a',text:'Повторна репліка першого учасника',gender:'female'}]}}}},runFanPageAuComments:async input=>{window.submitted=input;return {ok:true,data:{taskId:'demo'}}}};
createRoot(document.getElementById('root')).render(<CommentModal page={{id:'456',geo:'US',creativeName:'202'}} post={{id:'123',permalinkUrl:'https://www.facebook.com/permalink.php?story_fbid=123&id=456'}} accountKey='demo' countries={[{code:'US',name:'США'}]} groups={[{groupId:'g1',groupName:'[US] Тестова група'}]} settings={{}} onClose={()=>{}} onQueued={()=>{document.body.dataset.queued='yes'}} onError={()=>{}} />);`;
const server = await createServer({ root: path.resolve("frontend"), server: { host: "127.0.0.1", port: 0, strictPort: false, open: false },
    plugins: [{ name: "fanpage-au-preview", enforce: "pre",
        resolveId(id) { if (id === "/__fanpage-au.jsx") return path.resolve("frontend/__fanpage-au.jsx"); },
        load(id) { if (id.replaceAll("\\", "/").endsWith("/__fanpage-au.jsx")) return fixture; },
        configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
            if (req.url !== "/__fanpage-au") return next();
            res.setHeader("Content-Type", "text/html");
            res.end(await vite.transformIndexHtml(req.url, '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/__fanpage-au.jsx"></script></body></html>'));
        }); },
    }],
});
try {
    await server.listen();
    const require = createRequire(path.resolve("frontend/package.json"));
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const result = await promisify(execFile)(require("electron"), [path.resolve("frontend/electron/reviewFanPageAuComments.cjs"), `http://127.0.0.1:${server.httpServer.address().port}/__fanpage-au`], { env, windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 });
    console.log(result.stdout.trim());
} finally { await server.close(); }
