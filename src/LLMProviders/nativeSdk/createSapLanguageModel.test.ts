import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const runNode = promisify(execFile);

describe("createSapLanguageModel", () => {
  describe("createSapLanguageModel()", () => {
    it("preserves official SAP HTTP authorization, cached tokens and deployment discovery", async () => {
      const source = join(__dirname, "createSapLanguageModel.ts");
      const sdkDirectory = join(process.cwd(), "node_modules");
      const script = `
        import assert from "node:assert/strict";
        import {createRequire} from "node:module";
        import {mkdtemp, symlink, rm} from "node:fs/promises";
        import {tmpdir} from "node:os";
        import {join} from "node:path";
        import {pathToFileURL} from "node:url";
        const require=createRequire(${JSON.stringify(join(process.cwd(), "package.json"))});
        const esbuild=require("esbuild");
        const {default:nodeModuleShim,nodeBuiltinExternals}=await import(pathToFileURL(${JSON.stringify(join(process.cwd(), "nodeModuleShim.mjs"))}).href);
        const temp=await mkdtemp(join(tmpdir(), "copilot-sap-sdk-"));
        const {JSDOM}=require("jsdom");
        const dom=new JSDOM("",{url:"https://app.obsidian.md"});
        globalThis.window=dom.window;
        globalThis.document=dom.window.document;
        globalThis.XMLHttpRequest=dom.window.XMLHttpRequest;
        const requests=[];
        let mode="normal";
        let now=Date.now();
        const originalNow=Date.now;
        Date.now=()=>now;
        const response=(payload)=>new Response(JSON.stringify(payload),{headers:{"content-type":"application/json"}});
        globalThis.auditFetch=async(input,init)=>{
          const url=String(input);
          requests.push({url,body:init?.body,headers:new Headers(init?.headers)});
          if(url.endsWith("/oauth/token")){
            if(mode==="denied")return new Response("Denied",{status:401});
            if(mode==="invalid-token")return response({access_token:"",expires_in:3600});
            return response({access_token:"fixture-token",expires_in:3600});
          }
          if(url.includes("/deployments?"))return response({resources:mode==="no-deployments"?[]:[{id:"discovered-deployment"}]});
          if(JSON.parse(init?.body||"{}").config?.stream?.enabled){
            const chunks=[{request_id:"fixture-stream",final_result:{id:"fixture-completion",object:"chat.completion.chunk",created:1,model:"gpt-4.1",choices:[{index:0,delta:{role:"assistant",content:"SDK stream reply"},finish_reason:null}]}},{request_id:"fixture-stream",final_result:{id:"fixture-completion",object:"chat.completion.chunk",created:1,model:"gpt-4.1",choices:[{index:0,delta:{},finish_reason:"stop"}],usage:{prompt_tokens:1,completion_tokens:2,total_tokens:3}}}];
            return new Response(chunks.map(chunk=>"data: "+JSON.stringify(chunk)+"\\n\\n").join("")+"data: [DONE]\\n\\n",{headers:{"content-type":"text/event-stream"}});
          }
          return response({request_id:"fixture-request",intermediate_results:{},final_result:{id:"fixture-completion",object:"chat.completion",created:1,model:"gpt-4.1",choices:[{index:0,message:{role:"assistant",content:"Original SDK reply"},finish_reason:"stop"}],usage:{prompt_tokens:1,completion_tokens:2,total_tokens:3}}});
        };
        try {
          await symlink(${JSON.stringify(sdkDirectory)},join(temp,"node_modules"),"dir");
          const output=join(temp,"sap-factory.cjs");
          await esbuild.build({entryPoints:[${JSON.stringify(source)}],outfile:output,bundle:true,format:"cjs",target:"es2020",external:nodeBuiltinExternals,define:{global:"window","import.meta.url":"import_meta.url"},banner:{js:'var import_meta={url:require("node:url").pathToFileURL(__filename).href};'},plugins:[nodeModuleShim,{name:"memory-transport",setup(build){build.onResolve({filter:/providerTransport$/},()=>({path:"transport",namespace:"fixture"}));build.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:"export const createProviderFetch=()=>globalThis.auditFetch;"}));}}]});
          const {createSapLanguageModel}=require(output);
          const resolve=createSapLanguageModel({name:"gpt-4.1"},{clientId:"fixture-client",clientSecret:"fixture-secret",tokenUrl:"https://auth.fixture.invalid",apiUrl:"https://api.fixture.invalid",resourceGroup:"my-resource-group",deploymentId:""});
          const prompt=[{role:"user",content:[{type:"text",text:"Original private input"}]}];
          const first=await resolve({});
          const generated=await first.doGenerate({prompt});
          assert.equal(generated.content[0].text,"Original SDK reply");
          assert.equal(generated.usage.inputTokens,1);
          const streaming=await first.doStream({prompt});
          let streamed="";
          for await(const chunk of streaming.stream)if(chunk.type==="text-delta")streamed+=chunk.delta;
          assert.equal(streamed,"SDK stream reply");
          const second=await resolve({});
          await second.doGenerate({prompt});
          assert.equal(requests.filter(r=>r.url.endsWith("/oauth/token")).length,1);
          assert.equal(requests.filter(r=>r.url.includes("/deployments?")).length,1);
          now+=3600000;
          const third=await resolve({});
          await third.doGenerate({prompt});
          assert.equal(requests.filter(r=>r.url.endsWith("/oauth/token")).length,2);
          const inference=requests.find(r=>r.url.includes("/discovered-deployment/"));
          assert.equal(inference.headers.get("authorization"),"Bearer fixture-token");
          assert.equal(inference.headers.get("ai-resource-group"),"my-resource-group");
          assert.equal(JSON.parse(inference.body).config.modules.prompt_templating.prompt.template[0].content,"Original private input");
          const make=(deploymentId="fixed-deployment")=>createSapLanguageModel({name:"gpt-4.1"},{clientId:"fixture-client",clientSecret:"fixture-secret",tokenUrl:"https://auth.fixture.invalid",apiUrl:"https://api.fixture.invalid",resourceGroup:"my-resource-group",deploymentId});
          mode="denied";
          await assert.rejects(make()({}),/SAP authorization failed/);
          mode="invalid-token";
          await assert.rejects(make()({}),/did not return a valid access token/);
          mode="no-deployments";
          await assert.rejects(make("")({}),/no running orchestration deployment/);
          mode="normal";
          const beforeConcurrent=requests.filter(r=>r.url.endsWith("/oauth/token")).length;
          const concurrent=make();
          await Promise.all([concurrent({}),concurrent({})]);
          assert.equal(requests.filter(r=>r.url.endsWith("/oauth/token")).length,beforeConcurrent+1);
          process.stdout.write("SAP HTTP authorization, discovery, generation and refresh verified");
        } finally {
          Date.now=originalNow;
          dom.window.close();
          await rm(temp,{recursive:true,force:true});
        }
      `;
      const { stdout } = await runNode(process.execPath, [
        "--input-type=module",
        "--eval",
        script,
      ]).catch((error: Error & { stderr?: string; stdout?: string }) => {
        throw new Error(error.stderr || error.stdout || error.message);
      });
      expect(stdout).toContain(
        "SAP HTTP authorization, discovery, generation and refresh verified"
      );
    });
  });
});
