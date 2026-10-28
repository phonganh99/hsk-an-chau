
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
  return reply({ok:true,bot_ready:zaloBotConfigured(env),webhook_secret_ready:zaloWebhookConfigured(env),
    paired:!!target?.chat_id,chat_type:target?.chat_type||null,pending:pending?.total||0,
    webhook_url:ZALO_WEBHOOK_URL,webhook_api_ok:checks.api_status==="ok",
    webhook_url_matches:checks.url_matches,webhook_api_status:checks.api_status,
    webhook_diagnostics:audits.results||[],bot_account:identity.name,bot_identity_status:identity.status,recovery_active:recovery?.active===1&&recovery.expires_at>new Date().toISOString(),recovery_expires_at:recovery?.active===1?recovery.expires_at:null});
}
async function zaloSyncWebhook(env){
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
  if(data?.ok!==true)throw Error("zalo_api_error_"+(Number.isInteger(data?.error_code)?data.error_code:"unknown"));
  return data.result;
}
async function zaloIdentity(env){
  if(!zaloBotConfigured(env))return {name:null,status:"missing_token"};
  try{
    const info=await zaloApiCall(env,"getMe",{},3000);
    return {name:cleanText(info?.account_name,80)||null,status:"ok"};
  }catch{return {name:null,status:"unreachable"}}
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
    // Store only an allowlisted error category. Never persist webhook payload or token.
    const safeReason=/^zalo_(?:timeout|network_error|invalid_response|api_error_(?:[0-9]{1,5}|unknown)|http_[0-9]{3})$/.test(kind)?kind:"zalo_unknown_error";
    try{
      await env.DB.prepare("INSERT INTO zalo_webhook_diagnostics(reason,count,last_seen_at) VALUES(?,1,?) ON CONFLICT(reason) DO UPDATE SET count=count+1,last_seen_at=excluded.last_seen_at")
        .bind("poll_"+safeReason,new Date().toISOString()).run();
    }catch{}
    return reply({error:"zalo_polling_unavailable",stage:"getUpdates",zalo_reason:safeReason,retry:true},502);
  }
  for(const item of events){
    const event=item?.result&&typeof item.result==="object"?item.result:item;
    const msg=event?.message,txt=typeof msg?.text==="string"?msg.text.trim():"";
    const id=(typeof msg?.chat?.id==="string"||typeof msg?.chat?.id==="number")?String(msg.chat.id):"";
    if(event?.event_name!=="message.text.received"||String(msg?.chat?.chat_type||"").toUpperCase()!=="PRIVATE"||!id||id.length>128||!/^\/bind HSK-[A-F0-9]{24}$/i.test(txt))continue;
    if(await sha256Text(txt.slice(6).toUpperCase())!==rec.code_hash)continue;
    const used=await env.DB.prepare("UPDATE zalo_pair_codes SET used_at=? WHERE code_hash=? AND used_at IS NULL AND expires_at>?").bind(now,rec.code_hash,now).run();
    if((used.meta?.changes||0)!==1)continue;
    await env.DB.prepare("INSERT INTO zalo_notification_target(id,chat_id,chat_type,paired_at) VALUES('primary',?,'PRIVATE',?) ON CONFLICT(id) DO UPDATE SET chat_id=excluded.chat_id,chat_type='PRIVATE',paired_at=excluded.paired_at").bind(id,now).run();
    const restored=await restoreWebhook(env);
    const sent=await sendZaloText(env,id,"✅ Bot An Châu HSK đã ghép với CRM. Thông báo Lead mới sẽ gửi vào hội thoại này.");
    return reply({ok:true,paired:true,webhook_restored:restored,test_message_sent:sent});
  }
  try{
    await env.DB.prepare("INSERT INTO zalo_webhook_diagnostics(reason,count,last_seen_at) VALUES('poll_no_matching_code',1,?) ON CONFLICT(reason) DO UPDATE SET count=count+1,last_seen_at=excluded.last_seen_at")
      .bind(new Date().toISOString()).run();
  }catch{}
  return reply({ok:true,paired:false,retry:true,update_count:events.length});
}
async function recoveryCancel(env){
  const row=await env.DB.prepare("SELECT active FROM zalo_recovery_session WHERE id='primary'").first();
  if(row?.active!==1)return reply({ok:true,webhook_restored:true});
  const restored=await restoreWebhook(env);
  return reply({ok:restored,webhook_restored:restored},restored?200:502);
}

async function zaloSendTest(env) {
  const target=await getZaloRecipient(env);
  if(!target?.chat_id||!zaloBotConfigured(env))return reply({error:'zalo_not_paired'},409);
  const success=await sendZaloText(env,target.chat_id,'✅ An Châu HSK: CRM đã kết nối Zalo Bot. Thông báo Lead mới sẽ gửi tại đây.');
  return reply({ok:success,...(!success?{error:'zalo_delivery_failed'}:{})},success?200:502);
}
async function zaloWebhook(req,env,ctx) {
  if(!zaloWebhookConfigured(env))return reply({error:'webhook_not_ready'},503);
  const signature=req.headers.get("x-bot-api-secret-token")||"";
  if(!signature){await auditZalo(env,"missing_header");return reply({error:'unauthorized'},403);}
  if(!await tokenEqual(signature,env.ZALO_WEBHOOK_SECRET)){
    await auditZalo(env,"invalid_header");return reply({error:'unauthorized'},403);
  }
  let body;try{body=await readJson(req)}catch{
    await auditZalo(env,"invalid_json");return reply({error:'invalid_request'},400);
  }
  // Zalo's documented webhook wraps events in result; some actual deliveries are flat.
  // Accept either, but always require a valid X-Bot-Api-Secret-Token header first.
  const evt=(body?.result&&typeof body.result==='object')?body.result:body;
  if(evt?.event_name!=='message.text.received'){
    await auditZalo(env,"other_event");return reply({ok:true,handled:false});
  }
  const msg=evt.message;
  const text=typeof msg?.text==='string'?msg.text.trim():'';
  const chatId=(typeof msg?.chat?.id==='string'||typeof msg?.chat?.id==='number')?String(msg.chat.id):'';
  const chatType=String(msg?.chat?.chat_type||'').toUpperCase();
  // Pair only one staff member's private chat, never auto-pair a random incoming chat.
  if(chatType!=='PRIVATE'||!chatId||chatId.length>128||!/^\/bind HSK-[A-Fa-f0-9]{24}$/i.test(text)){
    await auditZalo(env,"invalid_pair");return reply({ok:true,handled:false});
  }
  const code=text.slice('/bind '.length).toUpperCase();
  const now=new Date().toISOString();
  const used=await env.DB.prepare("UPDATE zalo_pair_codes SET used_at=? WHERE code_hash=? AND used_at IS NULL AND expires_at>?")
    .bind(now,await sha256Text(code),now).run();
  if((used.meta?.changes||0)!==1){await auditZalo(env,"unknown_code");return reply({ok:true,handled:false});}
  await env.DB.prepare("INSERT INTO zalo_notification_target(id,chat_id,chat_type,paired_at) VALUES('primary',?,'PRIVATE',?) ON CONFLICT(id) DO UPDATE SET chat_id=excluded.chat_id,chat_type=excluded.chat_type,paired_at=excluded.paired_at")
    .bind(chatId,now).run();
  await auditZalo(env,"paired");
  if(ctx&&typeof ctx.waitUntil==='function')ctx.waitUntil(
    (async()=>{
      await sendZaloText(env,chatId,'✅ Đã kết nối Bot An Châu HSK với CRM. Bạn sẽ nhận thông báo khi có Lead mới.');
      await flushZaloOutbox(env,5);
    })().catch(()=>{})
  );
  return reply({ok:true,handled:true});
}

async function adminCreateLead(req,env,ctx) {
  let data;try{data=await readJson(req);}catch{return reply({error:'invalid_request'},400);}
  const name=cleanText(data.full_name,90),phone=normalizePhone(data.phone);
  const office=String(data.office||''),course=String(data.course||'');
  const preferred=String(data.preferred_slot||''),level=String(data.previous_level||'');
  const source=cleanText(data.source_code||'',48).toLowerCase();
  const assigned=cleanText(data.assigned_to||'',80),enteredBy=cleanText(data.entered_by||'',80);
  if(!phone||name.length<2||!OFFICES.has(office)||!COURSES.has(course)||!SLOTS.has(preferred)||!LEVELS.has(level)||
     !/^[a-z0-9_-]{3,48}$/.test(source)||enteredBy.length<2||data.privacy_confirmed!==true)
    return reply({error:'invalid_fields'},422);
  const validSource=await env.DB.prepare("SELECT code FROM lead_sources WHERE code=? AND is_active=1").bind(source).first();
  if(!validSource)return reply({error:'invalid_source'},422);
  const now=new Date().toISOString(),contactId=crypto.randomUUID(),oppId=crypto.randomUUID();
  await env.DB.prepare("INSERT OR IGNORE INTO contacts(id,full_name,phone,created_at,updated_at) VALUES(?,?,?,?,?)")
    .bind(contactId,name,phone,now,now).run();
  const contact=await env.DB.prepare("SELECT id FROM contacts WHERE phone=?").bind(phone).first();
  if(!contact)return reply({error:'storage_failed'},503);
  const inserted=await env.DB.prepare("INSERT OR IGNORE INTO opportunities(id,contact_id,program,course,office,preferred_slot,previous_level,status,assigned_to,first_source_code,last_source_code,privacy_notice_version,created_at,updated_at) VALUES(?,?,'HSK',?,?,?,?,'new',?,?,?,'manual-hsk-v1',?,?)")
    .bind(oppId,contact.id,course,office,preferred,level,assigned,source,source,now,now).run();
  const created=(inserted.meta?.changes||0)>0;
  const lead=await env.DB.prepare("SELECT id,created_at FROM opportunities WHERE contact_id=? AND program='HSK'").bind(contact.id).first();
  if(!lead)return reply({error:'storage_failed'},503);
  // Audit the staff-supplied name; until personal login is added this is NOT verified identity.
  await env.DB.prepare("INSERT INTO lead_events(id,opportunity_id,event_type,source_code,details,created_at) VALUES(?,?,?,?,?,?)")
    .bind(crypto.randomUUID(),lead.id,created?'manual_created':'manual_duplicate',source,JSON.stringify({entered_by:enteredBy}),now).run();
  if(created){await queueNewLeadNotification(env,lead.id,now);scheduleNotification(ctx,env);}
  return reply({ok:true,lead_code:lead.id,created,duplicate:!created,notification_queued:created},created?201:200);
}

async function adminLeads(url,env) {
  const office=url.searchParams.get("office")||"";
  const status=url.searchParams.get("status")||"";
  if((office&&!OFFICES.has(office))||(status&&!STATUSES.has(status)))return reply({error:"invalid_filter"},400);
  const limit=Math.min(Math.max(parseInt(url.searchParams.get("limit")||"100",10)||100,1),200);
  const offset=Math.min(Math.max(parseInt(url.searchParams.get("offset")||"0",10)||0,0),100000);
  let query="SELECT o.id,o.program,o.course,o.office,o.preferred_slot,o.previous_level,o.status,o.assigned_to,o.first_source_code,o.last_source_code,o.privacy_notice_version,o.created_at,o.updated_at,c.full_name,c.phone FROM opportunities o JOIN contacts c ON o.contact_id=c.id WHERE 1=1";
  const args=[];
  if(office){query+=" AND o.office=?";args.push(office);}
  if(status){query+=" AND o.status=?";args.push(status);}
  query+=" ORDER BY o.created_at DESC LIMIT ? OFFSET ?";args.push(limit,offset);
  const rows=await env.DB.prepare(query).bind(...args).all();
  return reply({ok:true,items:rows.results||[],limit,offset});
}
async function adminStats(env){
  const total=await env.DB.prepare("SELECT COUNT(*) AS count FROM opportunities").first();
  const grouped=await env.DB.prepare("SELECT status,COUNT(*) AS count FROM opportunities GROUP BY status").all();
  const byOffice=await env.DB.prepare("SELECT office,COUNT(*) AS count FROM opportunities GROUP BY office").all();
  return reply({ok:true,total:total?.count||0,by_status:grouped.results||[],by_office:byOffice.results||[]});
}
async function adminUpdate(req,env,id){
  let data;
  try{data=await readJson(req)}catch{return reply({error:"invalid_request"},400)}
  const status=String(data.status||"");
  const owner=cleanText(data.assigned_to||"",80);
  const changeStatus=data.status!==undefined;
  const changeOwner=data.assigned_to!==undefined;
  if(!changeStatus&&!changeOwner)return reply({error:"nothing_to_update"},400);
  if(changeStatus&&!STATUSES.has(status))return reply({error:"invalid_status"},422);
  const current=await env.DB.prepare("SELECT id,status,assigned_to FROM opportunities WHERE id=?").bind(id).first();
  if(!current)return reply({error:"not_found"},404);
  const nextStatus=changeStatus?status:current.status;
  const nextOwner=changeOwner?owner:current.assigned_to;
  const now=new Date().toISOString();
  await env.DB.prepare("UPDATE opportunities SET status=?,assigned_to=?,updated_at=? WHERE id=?").bind(nextStatus,nextOwner,now,id).run();
  const details=JSON.stringify({from_status:current.status,to_status:nextStatus,from_owner:current.assigned_to,to_owner:nextOwner});
  await env.DB.prepare("INSERT INTO lead_events(id,opportunity_id,event_type,details,created_at) VALUES(?,?,?,?,?)")
    .bind(crypto.randomUUID(),id,"admin_update",details,now).run();
  return reply({ok:true,id,status:nextStatus,assigned_to:nextOwner});
}
async function adminExport(env){
  const result=await env.DB.prepare("SELECT o.id,o.program,o.course,o.office,o.preferred_slot,o.previous_level,o.status,o.assigned_to,o.first_source_code,o.last_source_code,o.created_at,o.updated_at,c.full_name,c.phone FROM opportunities o JOIN contacts c ON c.id=o.contact_id ORDER BY o.created_at ASC LIMIT 20000").all();
  const columns=["id","full_name","phone","program","course","office","preferred_slot","previous_level","status","assigned_to","first_source_code","last_source_code","created_at","updated_at"];
  const csv="\uFEFF"+columns.map(csvCell).join(",")+"\r\n"+(result.results||[]).map(row=>columns.map(c=>csvCell(row[c])).join(",")).join("\r\n");
  return new Response(csv,{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":"attachment; filename=hsk-crm-export.csv","cache-control":"no-store","x-content-type-options":"nosniff"}});
}
async function adminSources(req,env){
  if(req.method==="GET"){const result=await env.DB.prepare("SELECT code,label,kind,is_active FROM lead_sources ORDER BY code").all();return reply({ok:true,items:result.results||[]});}
  let data;try{data=await readJson(req)}catch{return reply({error:"invalid_request"},400)}
  const code=cleanText(data.code,48).toLowerCase(),label=cleanText(data.label,100),kind=String(data.kind||"");
  if(!/^[a-z0-9_-]{3,48}$/.test(code)||label.length<2||!SOURCE_TYPES.has(kind))return reply({error:"invalid_fields"},422);
  await env.DB.prepare("INSERT INTO lead_sources(code,label,kind) VALUES(?,?,?)").bind(code,label,kind).run();
  return reply({ok:true,code},201);
}
export default {
  async fetch(req,env,ctx) {
    const url=new URL(req.url),path=url.pathname,method=req.method.toUpperCase();
    const cors=headersForOrigin(req);
    try {
      if(path==="/health"&&method==="GET")return reply({ok:true,storage_ready:!!env.DB,turnstile_ready:!!env.TURNSTILE_SECRET,admin_ready:!!(env.ADMIN_TOKEN&&env.ADMIN_TOKEN.length>=32),zalo_bot_ready:zaloBotConfigured(env),zalo_webhook_ready:zaloWebhookConfigured(env)});
      if(path==="/api/leads"&&method==="OPTIONS")return req.headers.get("origin")===SITE_ORIGIN?
        new Response(null,{status:204,headers:cors}):reply({error:"origin_not_allowed"},403);
      if(path==="/api/leads"&&method==="POST")return postLead(req,env,ctx);
      if(path==="/api/zalo/webhook"&&method==="POST")return zaloWebhook(req,env,ctx);
      if(path.startsWith("/api/admin/")){
        if(method==="OPTIONS")return req.headers.get("origin")===SITE_ORIGIN?new Response(null,{status:204,headers:cors}):reply({error:"origin_not_allowed"},403);
        if(!await isAdmin(req,env))return reply({error:"unauthorized"},401,cors);
        let result;
        if(path==="/api/admin/leads"&&method==="GET")result=await adminLeads(url,env);
        else if(path==="/api/admin/leads"&&method==="POST")result=await adminCreateLead(req,env,ctx);
        else if(path==="/api/admin/notifications/flush"&&method==="POST")result=reply({ok:true,...await flushZaloOutbox(env,15)});
        else if(path==="/api/admin/zalo/status"&&method==="GET")result=await zaloStatus(env);
        else if(path==="/api/admin/zalo/sync-webhook"&&method==="POST")result=await zaloSyncWebhook(env);
        else if(path==="/api/admin/zalo/recovery/start"&&method==="POST")result=await recoveryStart(env);
        else if(path==="/api/admin/zalo/recovery/finish"&&method==="POST")result=await recoveryFinish(env);
        else if(path==="/api/admin/zalo/recovery/cancel"&&method==="POST")result=await recoveryCancel(env);
        else if(path==="/api/admin/zalo/pair"&&method==="POST")result=await createZaloPairCode(env);
        else if(path==="/api/admin/zalo/test"&&method==="POST")result=await zaloSendTest(env);
        else if(path==="/api/admin/stats"&&method==="GET")result=await adminStats(env);
        else if(path==="/api/admin/export"&&method==="GET")result=await adminExport(env);
        else if(path==="/api/admin/sources"&&(method==="GET"||method==="POST"))result=await adminSources(req,env);
        else if(path.startsWith("/api/admin/leads/")&&method==="PATCH")result=await adminUpdate(req,env,decodeURIComponent(path.slice("/api/admin/leads/".length)));
        else result=reply({error:"not_found"},404);
        const newHeaders=new Headers(result.headers);for(const [k,v] of Object.entries(cors))newHeaders.set(k,v);
        return new Response(result.body,{status:result.status,headers:newHeaders});
      }
      return reply({error:"not_found"},404);
    } catch(err) {
      // Do not log student names, phone numbers, secrets or request bodies.
      console.error("HSK CRM request failed",String(err?.message||"unknown").slice(0,100));
      return reply({error:"internal_error"},500,cors);
    }
  },
  async scheduled(controller,env,ctx){
    ctx.waitUntil((async()=>{
      if(!env.DB||!zaloBotConfigured(env)||!zaloWebhookConfigured(env))return;
      const rec=await env.DB.prepare("SELECT active,expires_at,code_hash FROM zalo_recovery_session WHERE id='primary'").first();
      if(rec?.active!==1)return;
      if(rec.expires_at<=new Date().toISOString()){await recoveryAutoRestore(env);return;}
      // Check newly-arrived Zalo command once per minute while in the short-lived
      // recovery window, so manual confirmation is not the only way to pair.
      if(rec.code_hash)await recoveryFinish(env);
    })().catch(()=>{}));
  }
};
