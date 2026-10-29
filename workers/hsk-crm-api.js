import {aiCustomer} from "./ai-customer.js";

// Dedicated AI Worker. The existing an-chau-hsk-crm-api Worker stays untouched.
// Both Workers may access the same D1 database only after explicit deployment approval.
export default {
  async fetch(req,env,ctx){
    const url=new URL(req.url);
    if(url.pathname==="/health"&&req.method==="GET"){
      return new Response(JSON.stringify({
        ok:true,service:"hsk-ai-customer",database_ready:!!env.DB,
        web_enabled:String(env.AI_ENABLED)==="true",
        zalo_enabled:String(env.AI_ZALO_ENABLED)==="true",
        ai_mode:env.AI_API_KEY&&env.AI_MODEL?"ai":"guided_fallback"
      }),{headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
    }
    if(url.pathname==="/api/zalo/webhook"){
      url.pathname="/api/zalo/ai-webhook";
      return aiCustomer.fetch(new Request(url.toString(),req),env,ctx);
    }
    return aiCustomer.fetch(req,env,ctx);
  },
  async scheduled(controller,env,ctx){
    ctx.waitUntil(aiCustomer.scheduled(env).catch(()=>console.error("AI Customer scheduled job failed")));
  }
};
