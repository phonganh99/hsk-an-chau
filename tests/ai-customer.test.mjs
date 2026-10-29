import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {normalizePhone,normalizeText,isHandoffIntent,safeFallback,parseWebhookEvent,parseZaloConsult} from "../workers/ai-knowledge.js";

test("phone normalization handles VN country code and rejects invalid contact",()=>{
 assert.equal(normalizePhone("+84 912 345 678"),"0912345678");
 assert.equal(normalizePhone("0912345678"),"0912345678");
 assert.equal(normalizePhone("not-a-phone"),null);
});
test("sanitization strips control chars and limits length",()=>{
 assert.equal(normalizeText(" a\n\u0000b ",40),"a  b");
 assert.equal(normalizeText("x".repeat(1300)).length,1200);
});
test("handoff intent is explicit and does not invent CRM actions",()=>{
 assert.equal(isHandoffIntent("Tôi muốn gặp nhân viên tư vấn"),true);
 assert.equal(isHandoffIntent("Xin chào"),false);
 assert.match(safeFallback("Học phí HSK 3 bao nhiêu?"),/chưa có bảng chính sách/);
});
test("Zalo adapter only accepts private human text messages",()=>{
 const valid={ok:true,result:{event_name:"message.text.received",message:{from:{id:"a",is_bot:false},chat:{id:"private-1",chat_type:"PRIVATE"},text:"Tôi muốn học HSK 1",message_id:"m1",date:1000}}};
 assert.deepEqual(parseWebhookEvent(valid),{chatId:"private-1",messageId:"m1",timestamp:1000,text:"Tôi muốn học HSK 1"});
 valid.result.message.chat.chat_type="GROUP";
 assert.equal(parseWebhookEvent(valid),null);
 valid.result.message.chat.chat_type="PRIVATE";valid.result.message.from.is_bot=true;
 assert.equal(parseWebhookEvent(valid),null);
});
test("Zalo /tuvan requires opt-in and valid phone, not loose name matching",()=>{
 assert.equal(parseZaloConsult("/tuvan Nguyễn A | 0912345678 | HSK1 | HN"),null);
 assert.equal(parseZaloConsult("/tuvan Nguyễn A | abc | HSK1 | HN | DONGY"),null);
 assert.deepEqual(parseZaloConsult("/tuvan Nguyễn A | 0912345678 | HSK1 | HN | DONGY"),{
  full_name:"Nguyễn A",phone:"0912345678",course:"hsk1",office:"hn",consent:true
 });
});
test("HTML mounts web chat with safe DOM text rendering",()=>{
 const page=readFileSync(new URL("../index.html",import.meta.url),"utf8");
 const client=readFileSync(new URL("../assets/ai-chat.js",import.meta.url),"utf8");
 assert.match(page,/id="aiChatLaunch"/);
 assert.match(page,/id="aiChatHandoffForm"/);
 assert.match(client,/element\.textContent=message/);
 assert.doesNotMatch(client,/innerHTML\s*=/);
 assert.doesNotMatch(client,/localStorage|sessionStorage/);
});
test("legacy CRM main routes and production config are not modified",()=>{
 const entry=readFileSync(new URL("../workers/hsk-crm-api.js",import.meta.url),"utf8");
 assert.match(entry,/Dedicated AI Worker/);
 assert.doesNotMatch(entry,/import legacy/);
 const sample=readFileSync(new URL("../wrangler.toml.example",import.meta.url),"utf8");
 assert.match(sample,/REPLACE_WITH_STAGING_D1_ID/);
});
