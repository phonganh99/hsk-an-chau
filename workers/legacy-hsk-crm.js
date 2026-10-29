
const SITE_ORIGIN = "https://hsk.anchaugroup.com.vn";
const STATUSES = new Set(["new","contacted","invited","deposit","enrolled","lost"]);
const COURSES = new Set(["hsk1","hsk2","hsk3","combo","unsure"]);
const OFFICES = new Set(["hn","na"]);
const SLOTS = new Set(["","AC1","AC2","AC3","AC4"]);
const LEVELS = new Set(["","new","studied","unsure"]);
const SOURCE_TYPES = new Set(["direct","marketing","partner","staff"]);

function reply(body,status=200,extra={}) {
  return new Response(JSON.stringify(body),{
    status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer",...extra}
  });
}
function headersForOrigin(req) {
  return req.headers.get("origin")===SITE_ORIGIN?{
    "access-control-allow-origin":SITE_ORIGIN,
    "access-control-allow-methods":"POST,GET,PATCH,OPTIONS",
    "access-control-allow-headers":"Content-Type,Authorization",
    "access-control-max-age":"600",
    "vary":"Origin"
  }:{};
}
function normalizePhone(value) {
  const raw=String(value||"").trim().replace(/[\s.()-]/g,"");
  let digits=raw;
  if(digits.startsWith("+84"))digits="0"+digits.slice(3);
  else if(digits.startsWith("84")&&digits.length===11)digits="0"+digits.slice(2);
  return /^0[35789][0-9]{8}$/.test(digits)?digits:null;
}
function cleanText(value,maxLength=90) {
  if(typeof value!=="string")return "";
  return value.replace(/[\u0000-\u001F\u007F]/g,"").trim().slice(0,maxLength);
}
async function readJson(req) {
  const size=Number(req.headers.get("content-length")||"0");
  if(size>12000)throw new Error("body_too_large");
  const raw=await req.text();
  if(raw.length>12000)throw new Error("body_too_large");
  return JSON.parse(raw);
}
function csvCell(value){
  let str=String(value??"").replace(/[\r\n\t]+/g," ");
  if(/^[=+@-]/.test(str.trim()))str="'"+str;
  return '"'+str.replace(/"/g,'""')+'"';
}
async function tokenEqual(provided,expected) {
  if(!expected||expected.length<32||!provided)return false;
  const encoder=new TextEncoder();
  const [a,b]=await Promise.all([
    crypto.subtle.digest("SHA-256",encoder.encode(provided)),
    crypto.subtle.digest("SHA-256",encoder.encode(expected))
  ]);
  const x=new Uint8Array(a),y=new Uint8Array(b);
  let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];
  return diff===0;
}
async function isAdmin(req,env) {
  const header=req.headers.get("authorization")||"";
  if(!header.startsWith("Bearer "))return false;
  return tokenEqual(header.slice(7),env.ADMIN_TOKEN);
}
async function verifyTurnstile(token,env){
  if(!env.TURNSTILE_SECRET||typeof token!=="string"||token.length<10||token.length>2048)return false;
  const challenge=await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({secret:env.TURNSTILE_SECRET,response:token})
  });
  if(!challenge.ok)return false;
  const result=await challenge.json();
  return result.success===true&&result.hostname==="hsk.anchaugroup.com.vn"&&result.action==="hsk_registration";
}
async function postLead(req,env,ctx){
  if(req.headers.get("origin")!==SITE_ORIGIN)return reply({error:"origin_not_allowed"},403,headersForOrigin(req));
  if(!env.TURNSTILE_SECRET||!env.DB)return reply({error:"registration_not_ready"},503,headersForOrigin(req));
  let input;
  try{input=await readJson(req)}catch{return reply({error:"invalid_request"},400,headersForOrigin(req));}
  // Honeypot: legitimate users leave this field empty.
  if(input.company_website)return reply({error:"invalid_request"},400,headersForOrigin(req));
  const name=cleanText(input.full_name,90);
  const phone=normalizePhone(input.phone);
  const office=String(input.office||"");
  const course=String(input.course||"");
  const preferred=String(input.preferred_slot||"");
  const level=String(input.previous_level||"");
  const policyVersion=cleanText(input.privacy_notice_version,40);
  if(name.length<2||!phone||!OFFICES.has(office)||!COURSES.has(course)||!SLOTS.has(preferred)||!LEVELS.has(level)||policyVersion!=="hsk-privacy-v1"){
    return reply({error:"invalid_fields"},422,headersForOrigin(req));
  }
  let verified=false;
  try{verified=await verifyTurnstile(input.turnstile_token,env)}catch{verified=false;}
  if(!verified)return reply({error:"verification_failed"},422,headersForOrigin(req));
  const proposedCode=cleanText(input.source_code||"direct",48).toLowerCase();
  const sourceRow=/^[a-z0-9_-]{1,48}$/.test(proposedCode)?
    await env.DB.prepare("SELECT code FROM lead_sources WHERE code=? AND is_active=1").bind(proposedCode).first():null;
  const source=sourceRow?sourceRow.code:"direct";
  const now=new Date().toISOString();
  const contactId=crypto.randomUUID(),oppId=crypto.randomUUID();
  await env.DB.prepare("INSERT OR IGNORE INTO contacts(id,full_name,phone,created_at,updated_at) VALUES(?,?,?,?,?)")
    .bind(contactId,name,phone,now,now).run();
  const contact=await env.DB.prepare("SELECT id FROM contacts WHERE phone=?").bind(phone).first();
  if(!contact)return reply({error:"storage_failed"},503,headersForOrigin(req));
  await env.DB.prepare("INSERT OR IGNORE INTO opportunities(id,contact_id,program,course,office,preferred_slot,previous_level,status,first_source_code,last_source_code,privacy_notice_version,created_at,updated_at) VALUES(?,?,'HSK',?,?,?,?,'new',?,?,?,?,?)")
    .bind(oppId,contact.id,course,office,preferred,level,source,source,policyVersion,now,now).run();
  const lead=await env.DB.prepare("SELECT id,created_at FROM opportunities WHERE contact_id=? AND program='HSK'").bind(contact.id).first();
  if(!lead)return reply({error:"storage_failed"},503,headersForOrigin(req));
  // A repeated enquiry updates current interest only, never resets status/owner/first_source_code.
  await env.DB.prepare("UPDATE opportunities SET course=?,office=?,preferred_slot=?,previous_level=?,last_source_code=?,updated_at=? WHERE id=?")
    .bind(course,office,preferred,level,source,now,lead.id).run();
  await env.DB.prepare("INSERT INTO lead_events(id,opportunity_id,event_type,source_code,details,created_at) VALUES(?,?,?,?,?,?)")
    .bind(crypto.randomUUID(),lead.id,lead.id===oppId?"created":"re_submitted",source,"",now).run();
  if(lead.id===oppId){await queueNewLeadNotification(env,lead.id,now);scheduleNotification(ctx,env);}
  return reply({ok:true,lead_code:lead.id,received:true},201,headersForOrigin(req));
}


async function queueNewLeadNotification(env,leadId,now) {
  await env.DB.prepare("INSERT OR IGNORE INTO notification_outbox(id,opportunity_id,channel,event_type,status,created_at,updated_at) VALUES(?,?,'zalo','new_lead','pending',?,?)")
    .bind(crypto.randomUUID(),leadId,now,now).run();
}
function zaloBotConfigured(env) {
  return typeof env.ZALO_BOT_TOKEN==="string"&&env.ZALO_BOT_TOKEN.length>=20;
}
function zaloWebhookConfigured(env) {
  return typeof env.ZALO_WEBHOOK_SECRET==="string"&&env.ZALO_WEBHOOK_SECRET.length>=32;
}
function scheduleNotification(ctx,env) {
  if(ctx&&typeof ctx.waitUntil==="function"&&zaloBotConfigured(env))
    ctx.waitUntil(flushZaloOutbox(env,5).catch(()=>{}));
}
async function sendZaloText(env,chatId,message) {
  if(!zaloBotConfigured(env)||!chatId) return false;
  // The Zalo Bot token is secret and must not be logged or stored in the browser.
  try {
    const response=await fetch("https://bot-api.zaloplatforms.com/bot"+env.ZALO_BOT_TOKEN+"/sendMessage",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({chat_id:chatId,text:message}),
    });
    if(!response.ok)return false;
    const json=await response.json();
    return json.ok===true;
  } catch {return false;}
}
async function getZaloRecipient(env) {
  return env.DB.prepare("SELECT chat_id,chat_type,paired_at FROM zalo_notification_target WHERE id='primary'").first();
}
async function flushZaloOutbox(env,limit=10) {
  const configured=zaloBotConfigured(env);
  if(!configured)return {configured:false,paired:false,sent:0,failed:0};
  const target=await getZaloRecipient(env);
  if(!target?.chat_id)return {configured:true,paired:false,sent:0,failed:0};
  // Recover interrupted sending attempts after 15 minutes, without creating new leads.
  const cutoff=new Date(Date.now()-15*60*1000).toISOString();
  await env.DB.prepare("UPDATE notification_outbox SET status='pending',updated_at=? WHERE channel='zalo' AND status='sending' AND updated_at<? AND attempts<10").bind(new Date().toISOString(),cutoff).run();
  const results=await env.DB.prepare("SELECT n.id,n.opportunity_id,o.course,o.office,o.first_source_code FROM notification_outbox n JOIN opportunities o ON o.id=n.opportunity_id WHERE n.channel='zalo' AND n.event_type='new_lead' AND n.status='pending' AND n.attempts<10 ORDER BY n.created_at ASC LIMIT ?").bind(limit).all();
  let sent=0,failed=0;
  for(const n of results.results||[]){
    const now=new Date().toISOString();
    const lock=await env.DB.prepare("UPDATE notification_outbox SET status='sending',attempts=attempts+1,updated_at=? WHERE id=? AND status='pending'").bind(now,n.id).run();
    if((lock.meta?.changes||0)!==1)continue;
    const officeName=n.office==='hn'?'Hà Nội':'Nghệ An';
    const courseName={hsk1:'HSK 1',hsk2:'HSK 2',hsk3:'HSK 3',combo:'Combo 1–3',unsure:'Cần tư vấn'}[n.course]||'HSK';
    // Do not send students' names, telephone numbers or private notes.
    const message=['🔔 AN CHÂU · LEAD HSK MỚI','Mã: '+n.opportunity_id.slice(0,8),'Cơ sở: '+officeName,'Khóa: '+courseName,'Nguồn: '+n.first_source_code,'Xem CRM: https://hsk.anchaugroup.com.vn/crm/admin/'].join('\n');
    const ok=await sendZaloText(env,target.chat_id,message);
    await env.DB.prepare("UPDATE notification_outbox SET status=?,last_error=?,updated_at=? WHERE id=?")
      .bind(ok?'sent':'pending',ok?'':'zalo_delivery_failed',new Date().toISOString(),n.id).run();
    if(ok)sent++;else failed++;
  }
  return {configured:true,paired:true,sent,failed};
}
async function sha256Text(value){
  const buf=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buf),b=>b.toString(16).padStart(2,'0')).join('');
}
async function createZaloPairCode(env) {
  if(!zaloBotConfigured(env)||!zaloWebhookConfigured(env))
    return reply({error:'zalo_secrets_not_ready'},503);
  const bytes=new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const code='HSK-'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('').toUpperCase();
  const now=new Date().toISOString(),expiresAt=new Date(Date.now()+15*60*1000).toISOString();
  await env.DB.prepare("DELETE FROM zalo_pair_codes WHERE expires_at<?").bind(now).run();
  await env.DB.prepare("INSERT INTO zalo_pair_codes(code_hash,expires_at,created_at) VALUES(?,?,?)")
    .bind(await sha256Text(code),expiresAt,now).run();
  return reply({ok:true,command:'/bind '+code,expires_at:expiresAt});
}

const ZALO_WEBHOOK_URL="https://an-chau-hsk-crm-api.phonganh99.workers.dev/api/zalo/webhook";
const ZALO_AUDIT_REASONS=new Set(["missing_header","invalid_header","invalid_json","other_event","invalid_pair","unknown_code","paired"]);
async function auditZalo(env,reason) {
  // A small number of aggregate counters, never raw messages, chat IDs or credentials.
  if(!ZALO_AUDIT_REASONS.has(reason)||!env.DB)return;
  try {
    await env.DB.prepare("INSERT INTO zalo_webhook_diagnostics(reason,count,last_seen_at) VALUES(?,1,?) ON CONFLICT(reason) DO UPDATE SET count=count+1,last_seen_at=excluded.last_seen_at")
      .bind(reason,new Date().toISOString()).run();
  }catch{}
}
async function getZaloWebhookInfo(env) {
  if(!zaloBotConfigured(env))return {api_status:"bot_token_missing",url_matches:null};
  try {
    const response=await fetch("https://bot-api.zaloplatforms.com/bot"+env.ZALO_BOT_TOKEN+"/getWebhookInfo",{
      method:"POST",headers:{"content-type":"application/json"},body:"{}",signal:AbortSignal.timeout(6000)
    });
    if(!response.ok)return {api_status:response.status===401||response.status===403?"bot_token_rejected":"zalo_http_"+response.status,url_matches:null};
    const payload=await response.json();
    if(payload?.ok!==true)return {api_status:"zalo_api_error",url_matches:null};
    const current=payload?.result?.url;
    return {api_status:"ok",url_matches:typeof current==="string"?current===ZALO_WEBHOOK_URL:null};
  }catch(e){return {api_status:e?.name==="TimeoutError"||e?.name==="AbortError"?"timeout":"network_error",url_matches:null};}
}
async function zaloStatus(env) {
  const target=await getZaloRecipient(env);
  const pending=await env.DB.prepare("SELECT COUNT(*) AS total FROM notification_outbox WHERE channel='zalo' AND status='pending'").first();
  const [checks,identity]=await Promise.all([getZaloWebhookInfo(env),zaloIdentity(env)]);
  const audits=await env.DB.prepare("SELECT reason,count,last_seen_at FROM zalo_webhook_diagnostics ORDER BY reason").all();
  const recovery=await env.DB.prepare("SELECT active,expires_at FROM zalo_recovery_session WHERE id='primary'").first();
  const polling=await pollingBridgeStatus(env);
  return reply({ok:true,bot_ready:zaloBotConfigured(env),webhook_secret_ready:zaloWebhookConfigured(env),
    paired:!!target?.chat_id,chat_type:target?.chat_type||null,pending:pending?.total||0,
    webhook_url:ZALO_WEBHOOK_URL,webhook_api_ok:checks.api_status==="ok",
    webhook_url_matches:checks.url_matches,webhook_api_status:checks.api_status,
    webhook_diagnostics:audits.results||[],bot_account:identity.name,bot_id:identity.id,bot_identity_status:identity.status,recovery_active:recovery?.active===1&&recovery.expires_at>new Date().toISOString(),recovery_expires_at:recovery?.active===1?recovery.expires_at:null,
    polling_mode:polling?.mode||'off',polling_webhook_removed:polling?.webhook_removed===1,
    polling_last_poll_at:polling?.last_poll_at||null,polling_last_status:polling?.last_status||null,
    polling_last_update_count:polling?.last_update_count||0});
}
async function zaloTestWebhook(env){
  // This is a diagnostic operation only. It does not change the Webhook
  // configuration, pair chats, send messages, or expose Bot Token/Secret.
  if(!zaloBotConfigured(env))return reply({error:"zalo_bot_not_configured"},503);
  let response;
  try{
    response=await fetch("https://bot-api.zaloplatforms.com/bot"+env.ZALO_BOT_TOKEN+"/testWebhook",{
      method:"POST",headers:{"content-type":"application/json"},
      body:"{}",signal:AbortSignal.timeout(12000)
    });
  }catch(e){
    return reply({error:e?.name==="TimeoutError"||e?.name==="AbortError"?
      "test_webhook_timeout":"test_webhook_network_error"},502);
  }
  let payload;
  try{payload=await response.json()}catch{
    return reply({error:"test_webhook_invalid_response",api_http_status:response.status},502);
  }
  if(!response.ok||payload?.ok!==true){
    return reply({error:"test_webhook_api_rejected",
      api_http_status:response.status,
      api_error_code:Number.isInteger(payload?.error_code)?payload.error_code:null},502);
  }
  const result=payload?.result;
  if(!result||typeof result!=="object"||typeof result.ok!=="boolean")
    return reply({error:"test_webhook_result_unrecognized",api_http_status:response.status},502);
  // Only safe, allowlisted diagnostic fields are forwarded to the admin.
  return reply({ok:true,webhook_reachable:result.ok,
    webhook_http_status:Number.isInteger(result.status_code)?result.status_code:null,
    webhook_outcome:typeof result.outcome==="string"?result.outcome.slice(0,60):null,
    webhook_latency_ms:typeof result.latency_ms==="number"?result.latency_ms:null,
    webhook_url_matches:typeof result.url==="string"?result.url===ZALO_WEBHOOK_URL:null
  });
}

async function zaloSyncWebhook(env){
  const bridge=await pollingBridgeStatus(env);
  if(bridge?.mode==="pairing"||bridge?.mode==="paired")return reply({error:"polling_bridge_active_do_not_enable_webhook"},409);
  if(!zaloBotConfigured(env)||!zaloWebhookConfigured(env))
    return reply({error:"zalo_secrets_not_ready"},503);
  try {
    const response=await fetch("https://bot-api.zaloplatforms.com/bot"+env.ZALO_BOT_TOKEN+"/setWebhook",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({url:ZALO_WEBHOOK_URL,secret_token:env.ZALO_WEBHOOK_SECRET}),
      signal:AbortSignal.timeout(8000)
    });
    if(!response.ok)return reply({error:"zalo_webhook_update_failed",status:response.status},502);
    const payload=await response.json();
    if(payload?.ok!==true)return reply({error:"zalo_webhook_update_rejected",api_error_code:payload?.error_code||null},502);
    const confirm=await getZaloWebhookInfo(env);
    return reply({ok:confirm.url_matches===true,verified:confirm.url_matches===true,webhook_api_status:confirm.api_status},
      confirm.url_matches===true?200:502);
  } catch {return reply({error:"zalo_webhook_unreachable"},502);}
}


async function zaloApiCall(env,method,payload={},timeout=6000){
  let res;
  try{
    res=await fetch("https://bot-api.zaloplatforms.com/bot"+env.ZALO_BOT_TOKEN+"/"+method,{
      method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload),signal:AbortSignal.timeout(timeout)
    });
  }catch(e){throw Error(e?.name==="TimeoutError"||e?.name==="AbortError"?"zalo_timeout":"zalo_network_error")}
  if(!res.ok)throw Error("zalo_http_"+res.status);
  let data;
  try{data=await res.json()}catch{throw Error("zalo_invalid_response")}
  // Zalo long-poll returns error_code 408 when no new messages arrive during
  // the requested wait. This is a normal EMPTY poll, not a transport failure.
  if(method==="getUpdates"&&data?.ok!==true&&data?.error_code===408)return [];
  if(data?.ok!==true)throw Error("zalo_api_error_"+(Number.isInteger(data?.error_code)?data.error_code:"unknown"));
  return data.result;
}
async function zaloIdentity(env){
  if(!zaloBotConfigured(env))return {name:null,id:null,status:"missing_token"};
  try{
    const info=await zaloApiCall(env,"getMe",{},3000);
    const id=String(info?.id??"");
    return {name:cleanText(info?.account_name,80)||null,id:/^[0-9]{5,24}$/.test(id)?id:null,status:"ok"};
  }catch{return {name:null,id:null,status:"unreachable"}}
}
async function restoreWebhook(env){
  try {
    await zaloApiCall(env,"setWebhook",{url:ZALO_WEBHOOK_URL,secret_token:env.ZALO_WEBHOOK_SECRET},7000);
    const check=await getZaloWebhookInfo(env);
    if(check.url_matches!==true)return false;
    await env.DB.prepare("UPDATE zalo_recovery_session SET active=0 WHERE id='primary'").run();
    return true;
  }catch{return false}
}
async function recoveryAutoRestore(env){
  if(!env.DB||!zaloBotConfigured(env)||!zaloWebhookConfigured(env))return;
  const r=await env.DB.prepare("SELECT active,expires_at FROM zalo_recovery_session WHERE id='primary'").first();
  if(r?.active===1&&r.expires_at<=new Date().toISOString())await restoreWebhook(env);
}
async function recoveryStart(env){
  const bridge=await pollingBridgeStatus(env);
  if(bridge?.mode==="pairing"||bridge?.mode==="paired")return reply({error:"polling_bridge_active_use_normal_pair"},409);
  if(!zaloBotConfigured(env)||!zaloWebhookConfigured(env))return reply({error:"secrets_not_ready"},503);
  if((await getZaloRecipient(env))?.chat_id)return reply({error:"already_paired"},409);
  const old=await env.DB.prepare("SELECT active,expires_at FROM zalo_recovery_session WHERE id='primary'").first();
  if(old?.active===1&&old.expires_at>new Date().toISOString())
    return reply({error:"recovery_already_active",expires_at:old.expires_at},409);
  if(old?.active===1){
    const status=await getZaloWebhookInfo(env);
    // If webhook already exists, an earlier failed attempt cannot leave an active polling session.
    if(status.url_matches===true)
      await env.DB.prepare("UPDATE zalo_recovery_session SET active=0 WHERE id='primary'").run();
    else if(!await restoreWebhook(env))return reply({error:"webhook_restore_required",stage:"restore_previous_webhook"},503);
  }
  // Delete webhook FIRST. The previous implementation created and displayed a code
  // even when Zalo refused to enter polling mode.
  let deleteError=null;
  try{await zaloApiCall(env,"deleteWebhook",{},6000)}catch(e){deleteError=String(e?.message||"zalo_unknown_error").slice(0,60)}
  const state=await getZaloWebhookInfo(env);
  if(state.api_status!=="ok"||state.url_matches!==false){
    // The delete call may have succeeded despite a lost response. If Zalo cannot
    // confirm the webhook state, schedule automatic recovery rather than leave
    // the bot without a webhook and without an active recovery job.
    if(state.api_status!=="ok"){
      const now=new Date().toISOString();
      await env.DB.prepare("INSERT INTO zalo_recovery_session(id,started_at,expires_at,code_hash,active) VALUES('primary',?,?,?,1) ON CONFLICT(id) DO UPDATE SET started_at=excluded.started_at,expires_at=excluded.expires_at,code_hash=excluded.code_hash,active=1")
        .bind(now,now,"").run();
    }
    return reply({error:"zalo_delete_webhook_failed",stage:"deleteWebhook",
      zalo_reason:deleteError||"webhook_still_active",webhook_api_status:state.api_status,
      webhook_still_configured:state.url_matches===true},502);
  }
  const bytes=new Uint8Array(12);crypto.getRandomValues(bytes);
  const code="HSK-"+Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("").toUpperCase();
  const hash=await sha256Text(code);
  const now=new Date().toISOString(),until=new Date(Date.now()+180000).toISOString();
  try{
    await env.DB.prepare("INSERT INTO zalo_pair_codes(code_hash,expires_at,created_at) VALUES(?,?,?)").bind(hash,until,now).run();
    await env.DB.prepare("INSERT INTO zalo_recovery_session(id,started_at,expires_at,code_hash,active) VALUES('primary',?,?,?,1) ON CONFLICT(id) DO UPDATE SET started_at=excluded.started_at,expires_at=excluded.expires_at,code_hash=excluded.code_hash,active=1").bind(now,until,hash).run();
  }catch{
    // If DB write fails after deleting the webhook, prioritize recovering the bot connection.
    await restoreWebhook(env);
    return reply({error:"storage_failed_webhook_restore_attempted"},503);
  }
  return reply({ok:true,command:"/bind "+code,expires_at:until,mode:"polling"});
}

async function recoveryFinish(env){
  const rec=await env.DB.prepare("SELECT active,expires_at,code_hash FROM zalo_recovery_session WHERE id='primary'").first();
  if(!rec||rec.active!==1)return reply({error:"recovery_not_active"},409);
  const now=new Date().toISOString();
  if(rec.expires_at<=now){
    const restored=await restoreWebhook(env);
    return reply({error:"recovery_expired",webhook_restored:restored},409);
  }
  let events=[];
  try {
    const raw=await zaloApiCall(env,"getUpdates",{timeout:"2"},7000);
    events=Array.isArray(raw)?raw:Array.isArray(raw?.updates)?raw.updates:(raw&&typeof raw==="object"?[raw]:[]);
  }catch(e){
    const kind=String(e?.message||"zalo_unknown_error").slice(0,65);
    // Store only an allowlisted error category. Never persist webhook payload or --- TRUNCATED --- 44,217 chars