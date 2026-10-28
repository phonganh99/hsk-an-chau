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
