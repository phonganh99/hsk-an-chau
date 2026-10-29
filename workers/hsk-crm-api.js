import legacy from "./legacy-hsk-crm.js";
import {aiCustomer} from "./ai-customer.js";

// Reuse the production CRM implementation unmodified.
// The new routes remain gated by AI_ENABLED and AI_ZALO_ENABLED.
// No migration or bot webhook reconfiguration occurs on import/deployment.
export default {
  async fetch(req,env,ctx){
    const path=new URL(req.url).pathname;
    if(path.startsWith("/api/ai/")||path.startsWith("/api/admin/ai/")||path==="/api/zalo/ai-webhook"){
      return aiCustomer.fetch(req,env,ctx);
    }
    if(path==="/api/zalo/webhook"&&req.method==="POST"&&String(env.AI_ZALO_ENABLED)==="true"){
      // Keep existing /bind HSK-... flow for notification recipient pairing.
      // All other private text messages flow into the shared AI Customer Agent.
      let pairing=false;
      try{
        if(Number(req.headers.get("content-length")||"0")>10000)return new Response("too_large",{status:413});
        const data=await req.clone().json();
        const event=data?.result&&typeof data.result==="object"?data.result:data;
        pairing=event?.event_name==="message.text.received"&&/^\/bind\s+HSK-/i.test(String(event?.message?.text||""));
      }catch{return new Response("invalid_json",{status:400})}
      if(!pairing){
        const url=new URL(req.url);url.pathname="/api/zalo/ai-webhook";
        return aiCustomer.fetch(new Request(url.toString(),req),env,ctx);
      }
    }
    return legacy.fetch(req,env,ctx);
  },
  async scheduled(controller,env,ctx){
    // Both modules must have independent failure containment.
    const tasks=[Promise.resolve().then(()=>legacy.scheduled(controller,env,ctx))];
    if(String(env.AI_ENABLED)==="true"||String(env.AI_ZALO_ENABLED)==="true"){
      tasks.push(aiCustomer.scheduled(env));
    }
    const results=await Promise.allSettled(tasks);
    for(const r of results)if(r.status==="rejected")console.error("HSK scheduled module failed");
  }
};
