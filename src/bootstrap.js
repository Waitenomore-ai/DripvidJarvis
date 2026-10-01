'use strict';

const path = require('node:path');
const { createApp, createRuntime } = require('./app');
const { createSocialManager } = require('./social-manager');
const { createSocialServer } = require('./social-http');
const { createMetaProvider } = require('./social-meta');
const { createReleaseAnnouncer } = require('./release-announcer');
const { createWebSearchAdapter } = require('./adapters/web-search');
const { createWorkforceRuntime } = require('./workforce');

function createSocialManagerPath(env) { return env.JARVIS_SOCIAL_MANAGER_PATH || path.resolve(__dirname, '..', 'data', 'social-manager.json'); }
function sendWorkforceJson(res, statusCode, body) { res.statusCode = statusCode; res.setHeader('content-type', 'application/json; charset=utf-8'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(body)); }
function readWorkforceJson(req) { return new Promise((resolve, reject) => { const chunks=[]; let size=0; req.on('data', chunk=>{ size+=chunk.length; if(size>1024*1024){reject(new Error('Request body too large'));req.destroy();return;} chunks.push(chunk); }); req.on('end',()=>{if(!chunks.length)return resolve({});try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(new Error('Malformed JSON'));}}); req.on('error',reject); }); }
async function handleWorkforce(req,res,workforce){
  const url=new URL(req.url,'http://127.0.0.1'); const pathname=url.pathname;
  if(!pathname.startsWith('/api/workforce')) return false;
  try{
    if(req.method==='GET'&&pathname==='/api/workforce/state'){sendWorkforceJson(res,200,workforce.snapshot());return true;}
    if(req.method==='GET'&&pathname==='/api/workforce/employees'){sendWorkforceJson(res,200,{employees:workforce.registry.list()});return true;}
    if(req.method==='GET'&&pathname==='/api/workforce/tasks'){sendWorkforceJson(res,200,{tasks:workforce.tasks.list({employeeId:url.searchParams.get('employeeId')||undefined,status:url.searchParams.get('status')||undefined})});return true;}
    if(req.method==='GET'&&pathname==='/api/workforce/workflows'){sendWorkforceJson(res,200,{workflows:workforce.workflows.list()});return true;}
    if(req.method==='POST'&&pathname==='/api/workforce/workflows'){sendWorkforceJson(res,201,workforce.createWorkflow(await readWorkforceJson(req)));return true;}
    const workflowMatch=pathname.match(/^\/api\/workforce\/workflows\/([^/]+)$/);
    if(req.method==='GET'&&workflowMatch){const workflow=workforce.workflows.get(workflowMatch[1]);if(!workflow){sendWorkforceJson(res,404,{error:'Workflow not found'});return true;}sendWorkforceJson(res,200,workflow);return true;}
    const workflowApprove=pathname.match(/^\/api\/workforce\/workflows\/([^/]+)\/approve$/);
    if(req.method==='POST'&&workflowApprove){sendWorkforceJson(res,200,workforce.approveWorkflow(workflowApprove[1]));return true;}
    const workflowReject=pathname.match(/^\/api\/workforce\/workflows\/([^/]+)\/reject$/);
    if(req.method==='POST'&&workflowReject){const body=await readWorkforceJson(req);sendWorkforceJson(res,200,workforce.rejectWorkflow(workflowReject[1],body.reason));return true;}
    if(req.method==='POST'&&pathname==='/api/workforce/tasks'){sendWorkforceJson(res,201,workforce.createTask(await readWorkforceJson(req)));return true;}
    const executeMatch=pathname.match(/^\/api\/workforce\/tasks\/([^/]+)\/execute$/);
    if(req.method==='POST'&&executeMatch){sendWorkforceJson(res,200,await workforce.executeTask(executeMatch[1]));return true;}
    const respondMatch=pathname.match(/^\/api\/workforce\/tasks\/([^/]+)\/respond$/);
    if(req.method==='POST'&&respondMatch){
      const body=await readWorkforceJson(req);
      sendWorkforceJson(res,200,workforce.respondToTask(respondMatch[1],body.message));
      return true;
    }
    const taskMatch=pathname.match(/^\/api\/workforce\/tasks\/([^/]+)$/);
    if(req.method==='GET'&&taskMatch){const task=workforce.tasks.get(taskMatch[1]);if(!task){sendWorkforceJson(res,404,{error:'Task not found'});return true;}sendWorkforceJson(res,200,task);return true;}
    const handoffMatch=pathname.match(/^\/api\/workforce\/tasks\/([^/]+)\/handoff$/);
    if(req.method==='POST'&&handoffMatch){sendWorkforceJson(res,200,workforce.handoffTask(handoffMatch[1],await readWorkforceJson(req)));return true;}
    return false;
  }catch(error){const message=error&&error.message||'Workforce request failed';const status=/unknown task|unknown workflow/i.test(message)?404:/invalid|requires|missing|workflow is not/i.test(message)?400:500;sendWorkforceJson(res,status,{error:message});return true;}
}
function createJarvisServer({env=process.env,fetchImpl=globalThis.fetch,now}={}){
  const runtime=createRuntime({env,fetchImpl,now});
  const workforceWeb=runtime.config.webSearchEnabled?createWebSearchAdapter({config:runtime.config,fetchImpl}):null;
  const baseServer=createApp({runtime}); const fallbackHandler=baseServer.listeners('request')[0];
  const socialManager=createSocialManager({config:{socialManagerPath:createSocialManagerPath(env)},now});
  const workforceAutoRun=env.JARVIS_WORKFORCE_AUTORUN!=='false';
  const workforceAutoRunDelayMs=Number(env.JARVIS_WORKFORCE_AUTORUN_DELAY_MS||25);
  const workforce=createWorkforceRuntime({
    model:runtime.model,
    brain:runtime.brain,
    vault:runtime.vault,
    web:workforceWeb,
    dripvid:runtime.dripvid,
    socialManager,
    scoutAllowedDomains:runtime.config.scoutAllowedDomains,
    now,
    autoRunWorkflows:workforceAutoRun,
    autoRunDelayMs:Number.isFinite(workforceAutoRunDelayMs)?Math.max(0,workforceAutoRunDelayMs):25,
    statePath:env.JARVIS_WORKFORCE_STATE_PATH||path.resolve(__dirname,'..','data','workforce-state.json')
  });
  let metaProvider=null; if(env.JARVIS_META_PAGE_ID&&env.JARVIS_META_INSTAGRAM_ID&&env.JARVIS_META_PAGE_TOKEN)metaProvider=createMetaProvider({env,fetchImpl});
  const releaseAnnouncer=createReleaseAnnouncer({statePath:env.JARVIS_RELEASE_ANNOUNCEMENT_PATH||path.resolve(__dirname,'..','data','release-announcements.json'),socialManager,metaProvider,env,fetchImpl,now});
  const server=createSocialServer({socialManager,metaProvider,releaseAnnouncer,fallbackHandler:async(req,res)=>{if(await handleWorkforce(req,res,workforce))return;if(req.method==='GET'&&new URL(req.url,'http://127.0.0.1').pathname==='/workforce')req.url='/workforce.html';return fallbackHandler(req,res);}});
  return {runtime,workforce,socialManager,metaProvider,releaseAnnouncer,server};
}
function start(env=process.env){const {runtime,server}=createJarvisServer({env});server.listen(runtime.config.port,runtime.config.host,()=>console.log(`DripVid JARVIS listening on http://${runtime.config.host}:${runtime.config.port}`));return server;}
if(require.main===module)start();
module.exports={createJarvisServer,createSocialManagerPath,start};
