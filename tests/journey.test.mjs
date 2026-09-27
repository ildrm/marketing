import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { quietHours } from '../packages/integrations/messaging.mjs';

const dir=mkdtempSync(join(tmpdir(),'relay-journey-'));
const dbPath=join(dir,'journey.sqlite');
process.env.NODE_ENV='test';process.env.DEMO_MODE='true';process.env.DB_PATH=dbPath;
const { server }=await import('../apps/api/server.mjs');
let origin;
const cookies=new Map();
async function request(role,path,method='GET',data,extra={}){
  const headers={'content-type':'application/json',...extra};if(role&&cookies.has(role))headers.cookie=cookies.get(role);
  const response=await fetch(origin+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data),redirect:'manual'});
  const payload=response.headers.get('content-type')?.includes('application/json')?await response.json():null;
  return {response,payload};
}
async function login(role,userId){const r=await request(null,'/api/login','POST',{userId});assert.equal(r.response.status,200);cookies.set(role,r.response.headers.get('set-cookie').split(';')[0]);}

test('book → publish → click → convert → invoice → dispute → settle, tenant scoped and balanced',async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
  try{
    await login('advertiser','usr_advertiser');await login('owner','usr_owner');await login('operator','usr_operator');
    const daytimeZone=['UTC','Asia/Tokyo','Europe/London','America/Los_Angeles','Pacific/Auckland'].find(zone=>!quietHours(new Date(),zone));assert.ok(daytimeZone);
    let r=await request('advertiser','/api/permissions','POST',{to:'+15551234567',channel:'sms',purpose:'demo_offer',proofSource:'demo_form',proofText:'Synthetic test permission'});assert.equal(r.response.status,201);
    r=await request('advertiser','/api/messages/preflight','POST',{to:'+15551234567',purpose:'demo_offer',body:'Demo offer',timeZone:daytimeZone});assert.equal(r.payload.eligible,true);assert.equal(r.payload.estimate.segments,1);
    r=await request('advertiser','/api/messages','POST',{to:'+15551234567',purpose:'demo_offer',body:'Demo offer',timeZone:daytimeZone,idempotencyKey:'sms-1'});assert.equal(r.response.status,201);assert.equal(r.payload.status,'accepted');const messageId=r.payload.id;
    r=await request('advertiser','/api/messages','POST',{to:'+15551234567',purpose:'demo_offer',body:'Demo offer',timeZone:daytimeZone,idempotencyKey:'sms-1'});assert.equal(r.payload.deduplicated,true);
    r=await request('operator',`/api/messages/${messageId}/status`,'POST',{status:'delivered'});assert.equal(r.payload.status,'delivered');
    r=await request('advertiser','/api/permissions/withdraw','POST',{to:'+15551234567',purpose:'demo_offer'});assert.equal(r.payload.status,'withdrawn');
    r=await request('advertiser','/api/messages','POST',{to:'+15551234567',purpose:'demo_offer',body:'Another demo',timeZone:daytimeZone,idempotencyKey:'sms-2'});assert.equal(r.response.status,403);
    r=await request('advertiser','/api/campaigns','POST',{name:'Autumn launch',objective:'leads',budgetMinor:20000,currency:'USD',destination:'https://example.com/offer'});
    assert.equal(r.response.status,201);const campaignId=r.payload.id;
    r=await request('advertiser','/api/campaigns','POST',{name:'Unsafe',objective:'traffic',budgetMinor:1000,currency:'USD',destination:'https://evil.test/'});assert.equal(r.response.status,400);
    r=await request('advertiser',`/api/campaigns/${campaignId}/status`,'POST',{status:'submitted'});assert.equal(r.response.status,200);
    r=await request('owner','/api/review');assert.equal(r.response.status,403);
    r=await request('advertiser','/api/diagnostics');assert.equal(r.response.status,403);
    r=await request('operator','/api/review','POST',{kind:'campaign',id:campaignId,decision:'approve'});assert.equal(r.response.status,200);
    r=await request('advertiser','/api/bookings','POST',{campaignId,inventoryId:'sku_cityletter'});assert.equal(r.response.status,201);const bookingId=r.payload.id;
    r=await request('advertiser','/api/bookings','POST',{campaignId,inventoryId:'sku_cityletter'});assert.equal(r.response.status,409);
    r=await request('owner',`/api/bookings/${bookingId}/accept`,'POST',{});assert.equal(r.response.status,200);
    r=await request('owner',`/api/bookings/${bookingId}/publish`,'POST',{proofUrl:'https://example.com/proof'});assert.equal(r.response.status,200);const redirectPath=new URL(r.payload.trackingUrl).pathname;
    r=await request(null,redirectPath,'HEAD');assert.equal(r.response.status,302);
    r=await request(null,redirectPath,'GET',undefined,{'user-agent':'SomeBot/1.0'});assert.equal(r.response.status,302);
    r=await request(null,redirectPath,'GET',undefined,{'user-agent':'Browser QA'});assert.equal(r.response.status,302);assert.equal(r.response.headers.get('location'),'https://example.com/offer');
    r=await request('advertiser','/api/conversions','POST',{bookingId,eventId:'crm-001',stage:'qualified',valueMinor:50000});assert.equal(r.response.status,201);assert.equal(r.payload.deduplicated,false);
    r=await request('advertiser','/api/conversions','POST',{bookingId,eventId:'crm-001',stage:'qualified',valueMinor:50000});assert.equal(r.payload.deduplicated,true);
    r=await request('advertiser','/api/keys','POST',{});assert.equal(r.response.status,201);const sandboxKey=r.payload.token;
    r=await request(null,'/api/v1/conversions','POST',{bookingId,eventId:'server-001',stage:'lead',occurredAt:new Date().toISOString(),consentSignal:'granted'}, {authorization:`Bearer ${sandboxKey}`});assert.equal(r.response.status,201);
    r=await request(null,'/api/v1/conversions','POST',{bookingId,eventId:'server-001',stage:'lead',occurredAt:new Date().toISOString(),consentSignal:'granted'}, {authorization:`Bearer ${sandboxKey}`});assert.equal(r.payload.deduplicated,true);
    r=await request(null,'/api/v1/conversions','POST',{bookingId,eventId:'server-002',stage:'lead'}, {authorization:`Bearer ${sandboxKey}`});assert.equal(r.response.status,400);
    r=await request(null,'/api/v1/conversions','POST',{bookingId,eventId:'server-003',stage:'lead',occurredAt:new Date().toISOString(),consentSignal:'granted'}, {authorization:'Bearer wrong'});assert.equal(r.response.status,401);
    r=await request('advertiser','/api/report');assert.equal(r.payload.rows[0].clicks,1);assert.equal(r.payload.rows[0].qualified_leads,1);
    r=await request('advertiser',`/api/bookings/${bookingId}/invoice`);assert.equal(r.payload.totalMinor,12000);assert.equal(r.payload.ownerPayableMinor,10200);
    r=await request('advertiser',`/api/bookings/${bookingId}/dispute`,'POST',{});assert.equal(r.payload.status,'disputed');
    r=await request('operator',`/api/bookings/${bookingId}/settle`,'POST',{});assert.equal(r.response.status,409);
    r=await request('operator',`/api/bookings/${bookingId}/resolve`,'POST',{});assert.equal(r.payload.status,'published');
    r=await request('operator',`/api/bookings/${bookingId}/settle`,'POST',{});assert.equal(r.payload.status,'settled');
    r=await request('operator',`/api/bookings/${bookingId}/settle`,'POST',{});assert.equal(r.response.status,409);
    r=await request('owner','/api/finance');assert.ok(r.payload.entries.some(e=>e.account==='owner_receivable'&&e.amount===10200));
    r=await request('operator','/api/diagnostics');assert.equal(r.payload.ledger.unbalancedBatches,0);assert.ok(r.payload.outbox.unprocessed>0);assert.equal(r.payload.outbox.consumer,'not_configured');
    r=await request('operator','/api/reconciliation');assert.equal(r.payload.discrepancyCount,0);assert.equal(r.payload.rows[0].status,'settled');assert.equal(r.payload.externalProvidersReconciled,false);
    r=await request('owner','/api/campaigns');assert.equal(r.payload.length,0);
    r=await request('owner','/api/conversions','POST',{bookingId,eventId:'forged',stage:'qualified'});assert.equal(r.response.status,403);
    const db=new DatabaseSync(dbPath);const batches=db.prepare('SELECT batch_id,SUM(amount) AS total FROM ledger_entries GROUP BY batch_id').all();assert.ok(batches.every(b=>b.total===0));assert.equal(db.prepare('SELECT COUNT(*) AS count FROM permission_history').get().count,2);assert.throws(()=>db.prepare('DELETE FROM permission_history').run());
    db.prepare('INSERT INTO organizations(id,name,type,created_at) VALUES(?,?,?,?)').run('org_other','Other advertiser','advertiser',new Date().toISOString());
    db.prepare('INSERT INTO users(id,name,email,org_id,role,created_at) VALUES(?,?,?,?,?,?)').run('usr_other','Other buyer','other@relay.demo','org_other','advertiser',new Date().toISOString());db.close();
    await login('other','usr_other');
    r=await request('other','/api/bookings');assert.equal(r.payload.length,0);
    r=await request('other','/api/report');assert.equal(r.payload.rows.length,0);
    r=await request('other','/api/finance');assert.equal(r.payload.entries.length,0);
    r=await request('other',`/api/bookings/${bookingId}/invoice`);assert.equal(r.response.status,404);
    r=await request('other','/api/conversions','POST',{bookingId,eventId:'forged-2',stage:'qualified'});assert.equal(r.response.status,404);
  }finally{await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});}
});
