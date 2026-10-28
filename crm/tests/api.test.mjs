import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const origin="https://hsk.anchaugroup.com.vn";
function req(path,opts){return new Request("https://crm.example.workers.dev"+path,opts)}
test("health endpoint is public and reveals readiness only",async()=>{
  const res=await worker.fetch(req("/health"),{});
  assert.equal(res.status,200);
  const body=await res.json();
  assert.equal(body.storage_ready,false);
  assert.equal(body.turnstile_ready,false);
  assert.equal("phone" in body,false);
});
test("cross-origin lead submission rejected",async()=>{
  const res=await worker.fetch(req("/api/leads",{method:"POST",headers:{"origin":"https://evil.example","content-type":"application/json"},body:"{}"}),{});
  assert.equal(res.status,403);
  assert.equal((await res.json()).error,"origin_not_allowed");
});
test("lead endpoint fails closed without private database and Turnstile",async()=>{
  const res=await worker.fetch(req("/api/leads",{method:"POST",headers:{"origin":origin,"content-type":"application/json"},body:"{}"}),{});
  assert.equal(res.status,503);
  assert.equal(res.headers.get("access-control-allow-origin"),origin);
});
test("only the approved landing origin receives CORS preflight",async()=>{
  const yes=await worker.fetch(req("/api/leads",{method:"OPTIONS",headers:{"origin":origin}}),{});
  assert.equal(yes.status,204);
  const no=await worker.fetch(req("/api/leads",{method:"OPTIONS",headers:{"origin":"https://other.example"}}),{});
  assert.equal(no.status,403);
});
test("admin endpoints never reveal data without valid token",async()=>{
  const res=await worker.fetch(req("/api/admin/leads"),{ADMIN_TOKEN:"a".repeat(48)});
  assert.equal(res.status,401);
  const other=await worker.fetch(req("/api/admin/export",{headers:{"Authorization":"Bearer wrong"}}),{ADMIN_TOKEN:"a".repeat(48)});
  assert.equal(other.status,401);
});
test("invalid Turnstile tokens cannot create leads",async()=>{
  const env={DB:{},TURNSTILE_SECRET:"secret"};
  const body={full_name:"Test Học viên",phone:"0912345678",office:"hn",course:"hsk1",previous_level:"new",preferred_slot:"AC1",privacy_notice_version:"hsk-privacy-v1",turnstile_token:""};
  const res=await worker.fetch(req("/api/leads",{method:"POST",headers:{"origin":origin,"content-type":"application/json"},body:JSON.stringify(body)}),env);
  assert.equal(res.status,422);
});

test("manual leads require bearer auth before accessing the database",async()=>{
  const body={full_name:"Khách thử nghiệm",phone:"0912345678",office:"hn",course:"hsk1",source_code:"zalo_sale",entered_by:"Nhân viên",privacy_confirmed:true};
  const res=await worker.fetch(req("/api/admin/leads",{method:"POST",headers:{"origin":origin,"content-type":"application/json"},body:JSON.stringify(body)}),{ADMIN_TOKEN:"s".repeat(48),DB:{}});
  assert.equal(res.status,401);
  assert.equal((await res.json()).error,"unauthorized");
});
test("manual lead requires employee name and customer notice acknowledgement",async()=>{
  const key="s".repeat(48);
  const body={full_name:"Khách thử nghiệm",phone:"0912345678",office:"hn",course:"hsk1",source_code:"zalo_sale",entered_by:"Nhân viên",privacy_confirmed:false};
  const res=await worker.fetch(req("/api/admin/leads",{method:"POST",headers:{"origin":origin,"Authorization":"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify(body)}),{ADMIN_TOKEN:key,DB:{}});
  assert.equal(res.status,422);
  assert.equal((await res.json()).error,"invalid_fields");
});
test("notification retry endpoint denies anonymous callers",async()=>{
  const res=await worker.fetch(req("/api/admin/notifications/flush",{method:"POST",headers:{"origin":origin}}),{ADMIN_TOKEN:"s".repeat(48)});
  assert.equal(res.status,401);
});
test("health reports Zalo readiness without exposing credentials",async()=>{
  const botToken="12345678901234567890123456789012345";
  const webhookSecret="s".repeat(48);
  const res=await worker.fetch(req("/health"),{ZALO_BOT_TOKEN:botToken,ZALO_WEBHOOK_SECRET:webhookSecret});
  const data=await res.json();
  assert.equal(data.zalo_bot_ready,true);
  assert.equal(data.zalo_webhook_ready,true);
  assert.equal(JSON.stringify(data).includes(botToken),false);
  assert.equal(JSON.stringify(data).includes(webhookSecret),false);
});
test("Zalo webhook requires verified secret",async()=>{
  const res=await worker.fetch(req("/api/zalo/webhook",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({ok:true,result:{event_name:"message.text.received"}})}),{ZALO_WEBHOOK_SECRET:"s".repeat(48)});
  assert.equal(res.status,403);
});
test("Admin Zalo pairing only works for authenticated admin",async()=>{
  const res=await worker.fetch(req("/api/admin/zalo/pair",{method:"POST"}),{ADMIN_TOKEN:"s".repeat(48)});
  assert.equal(res.status,401);
});

test("Zalo Bot webhook accepts both documented and flat event formats when secret matches",async()=>{
  const secret="s".repeat(48);
  const calls=[];
  const db={prepare(sql){
    return {bind(...args){
      calls.push({statement:sql.slice(0,60),boundCount:args.length});
      return {
        run:async()=>({meta:{changes:1}})
      };
    }};
  }};
  const event={event_name:"message.text.received",message:{
    chat:{id:"private-chat-test",chat_type:"PRIVATE"},
    text:"/bind HSK-0123456789ABCDEF01234567"
  }};
  for(const payload of [event,{ok:true,result:event}]){
    const reqOptions={method:"POST",headers:{"content-type":"application/json","x-bot-api-secret-token":secret},body:JSON.stringify(payload)};
    const res=await worker.fetch(req("/api/zalo/webhook",reqOptions),{ZALO_WEBHOOK_SECRET:secret,DB:db});
    assert.equal(res.status,200);
    assert.equal((await res.json()).handled,true);
  }
  assert.ok(calls.length>=4);
});

test("Admin-only Zalo webhook resync denies anonymous attempts",async()=>{
  const res=await worker.fetch(req("/api/admin/zalo/sync-webhook",{method:"POST"}),{ADMIN_TOKEN:"s".repeat(48)});
  assert.equal(res.status,401);
});
test("Authenticated webhook resync fails closed without Zalo credentials",async()=>{
  const key="s".repeat(48);
  const res=await worker.fetch(req("/api/admin/zalo/sync-webhook",{method:"POST",headers:{"authorization":"Bearer "+key}}),{ADMIN_TOKEN:key});
  assert.equal(res.status,503);
});

test("Polling recovery is administrator-only",async()=>{
  const paths=["/api/admin/zalo/recovery/start","/api/admin/zalo/recovery/finish","/api/admin/zalo/recovery/cancel"];
  for(const path of paths){
    const res=await worker.fetch(req(path,{method:"POST"}),{ADMIN_TOKEN:"x".repeat(48)});
    assert.equal(res.status,401);
  }
});
test("Polling recovery start fails closed if Zalo secrets unavailable",async()=>{
  const key="x".repeat(48);
  const res=await worker.fetch(req("/api/admin/zalo/recovery/start",{method:"POST",headers:{"Authorization":"Bearer "+key}}),{ADMIN_TOKEN:key});
  assert.equal(res.status,503);
});
test("Worker declares cron handler for automatic Webhook restoration",()=>{
  assert.equal(typeof worker.scheduled,"function");
});

test("Recovery start does not generate a pairing code if Zalo webhook deletion fails",async()=>{
  const key="z".repeat(48);
  const db={prepare(sql){
    if(sql.includes("FROM zalo_notification_target"))return {first:async()=>null};
    if(sql.includes("FROM zalo_recovery_session"))return {first:async()=>null};
    throw Error("Unexpected DB query before checking deletion: "+sql.slice(0,45));
  }};
  const realFetch=globalThis.fetch;
  // In this test Zalo refuses to delete and still reports the existing webhook.
  globalThis.fetch=async url=>{
    if(String(url).endsWith("/deleteWebhook"))return new Response(JSON.stringify({ok:false,error_code:429}),{headers:{"content-type":"application/json"}});
    if(String(url).endsWith("/getWebhookInfo"))return new Response(JSON.stringify({ok:true,result:{url:"https://an-chau-hsk-crm-api.phonganh99.workers.dev/api/zalo/webhook"}}),{headers:{"content-type":"application/json"}});
    throw Error("Unexpected request");
  };
  try{
    const res=await worker.fetch(req("/api/admin/zalo/recovery/start",{method:"POST",headers:{"Authorization":"Bearer "+key}}),{
      ADMIN_TOKEN:key,ZALO_BOT_TOKEN:"a".repeat(25),ZALO_WEBHOOK_SECRET:"b".repeat(40),DB:db
    });
    assert.equal(res.status,502);
    const data=await res.json();
    assert.equal(data.error,"zalo_delete_webhook_failed");
    assert.equal(data.zalo_reason,"zalo_api_error_429");
    assert.equal(data.webhook_still_configured,true);
    assert.equal("command" in data,false);
  }finally{globalThis.fetch=realFetch;}
});


test("Zalo polling errors are categorized without exposing credentials or messages",async()=>{
  const secret="s".repeat(48);
  const db={prepare(sql){return {
    first:async()=>({active:1,expires_at:new Date(Date.now()+100000).toISOString(),code_hash:"x".repeat(64)}),
    bind(){return {run:async()=>({meta:{changes:1}})}}
  }}};
  const realFetch=globalThis.fetch;
  globalThis.fetch=async url=>{
    if(String(url).endsWith("/getUpdates"))
      return new Response(JSON.stringify({ok:false,error_code:409,description:"Sensitive upstream text"}),{status:200,headers:{"content-type":"application/json"}});
    throw Error("Unexpected API");
  };
  try{
    const res=await worker.fetch(req("/api/admin/zalo/recovery/finish",{method:"POST",headers:{"Authorization":"Bearer "+secret}}),{DB:db,ADMIN_TOKEN:secret,ZALO_BOT_TOKEN:"t".repeat(36)});
    assert.equal(res.status,502);
    const data=await res.json();
    assert.equal(data.error,"zalo_polling_unavailable");
    assert.equal(data.zalo_reason,"zalo_api_error_409");
    assert.equal(JSON.stringify(data).includes("Sensitive upstream text"),false);
  }finally{globalThis.fetch=realFetch}
});
