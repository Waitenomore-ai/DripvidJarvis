'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const{createMcpAdapter}=require('../src/adapters/mcp');

function response(status,body){
  return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
}

function adapterWithTools(tools,callResult={ok:true}){
  return createMcpAdapter({
    config:{mcpEndpoint:'http://127.0.0.1:8788/mcp',mcpBearer:'test',requestTimeoutMs:1000},
    fetchImpl:async(url,options)=>{
      const request=JSON.parse(options.body);
      if(request.method==='tools/list')return response(200,{jsonrpc:'2.0',id:request.id,result:{tools}});
      if(request.method==='tools/call')return response(200,{jsonrpc:'2.0',id:request.id,result:callResult});
      return response(500,{error:'unexpected'});
    }
  });
}

test('approved diagnostic MCP tools are explicitly read-only without annotations',async()=>{
  const names=['server_info','disk_status','network_status','service_status','service_logs','http_health','dripvid_health','dripvid_git_status','dripvid_config'];
  const adapter=adapterWithTools(names.map(name=>({name,description:name,inputSchema:{type:'object'}})));
  const tools=await adapter.listTools();
  assert.deepEqual(tools.map(tool=>[tool.name,tool.mutating]),names.map(name=>[`mcp.${name}`,false]));
});

test('unknown MCP tools remain mutating by default',async()=>{
  const adapter=adapterWithTools([{name:'restart_service',inputSchema:{type:'object'}}]);
  const tools=await adapter.listTools();
  assert.equal(tools[0].mutating,true);
});

test('dripvid_config results redact sensitive keys recursively',async()=>{
  const adapter=adapterWithTools([],{publicUrl:'https://dripvid.uk',apiKey:'abc',nested:{token:'def',password:'ghi',safe:'yes'},databaseUrl:'postgres://secret',bearer:'secret',sessionSecret:'secret'});
  const result=await adapter.callTool('mcp.dripvid_config',{});
  assert.equal(result.publicUrl,'https://dripvid.uk');
  assert.equal(result.nested.safe,'yes');
  assert.equal(result.apiKey,'[REDACTED]');
  assert.equal(result.nested.token,'[REDACTED]');
  assert.equal(result.nested.password,'[REDACTED]');
  assert.equal(result.databaseUrl,'[REDACTED]');
  assert.equal(result.bearer,'[REDACTED]');
  assert.equal(result.sessionSecret,'[REDACTED]');
});
