import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {Script} from "node:vm";
const html=readFileSync(new URL("../admin/index.html",import.meta.url),"utf8");
const inline=html.match(/<script>([\s\S]*?)<\/script>/i);
test("Admin CRM inline JavaScript is valid",()=>{
  assert.ok(inline?.[1],"Inline script missing");
  assert.doesNotThrow(()=>new Script(inline[1],{filename:"crm/admin/index.html"}));
});
test("Zalo connection button is wired to visible feedback and timeout",()=>{
  assert.match(html,/id="zaloCheck"/);
  assert.match(html,/addEventListener\("click",\(\)=>\{void zaloCheck\(\);\}\)/);
  assert.match(html,/btn\.textContent="Đang kiểm tra\.\.\."/);
  assert.match(html,/btn\.textContent="Kiểm tra kết nối"/);
  assert.match(html,/controller\.abort\(\)/);
});

test("CRM requires verified admin session before Zalo actions",()=>{
  assert.match(html,/var apiBase="",adminToken="",authenticated=false/);
  assert.match(html,/if\(!authenticated\|\|!apiBase\|\|!adminToken\)/);
  assert.match(html,/askForLogin\("Anh cần đăng nhập CRM trước khi đồng bộ Webhook/);
});
test("CRM verifies login via backend before clearing input token",()=>{
  const verify=html.indexOf('const res=await fetch(url.origin+"/api/admin/stats"');
  const success=html.indexOf('apiBase=url.origin;adminToken=candidate;authenticated=true;');
  const clear=html.lastIndexOf('$("token").value="";');
  assert.ok(verify>0);
  assert.ok(success>verify);
  assert.ok(clear>success);
  assert.match(html,/if\(res.status===401\)throw Error\("ADMIN_TOKEN chưa đúng/);
});

test("Active Zalo recovery session guides the user to finish or cancel instead of retrying start",()=>{
  assert.match(html,/data\.error==="recovery_already_active"/);
  assert.match(html,/Đã có phiên ghép đang hoạt động tới/);
  assert.match(html,/Nếu anh đã gửi mã trong phiên này/);
  assert.match(html,/Hủy \/ Khôi phục Webhook/);
});
