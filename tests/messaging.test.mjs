import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeE164, smsSegments, quietHours, getAdapter } from '../packages/integrations/messaging.mjs';

test('SMS E.164 and GSM/Unicode segment preflight',()=>{
  assert.equal(normalizeE164('+1 (555) 123-4567'),'+15551234567');
  assert.throws(()=>normalizeE164('5551234567'));
  assert.deepEqual(smsSegments('hello'),{encoding:'GSM-7',units:5,segments:1});
  assert.equal(smsSegments('^'.repeat(81)).segments,2);
  assert.equal(smsSegments('سلام'.repeat(20)).segments,2);
});
test('quiet hours account for contact timezone',()=>{
  assert.equal(quietHours(new Date('2026-09-27T02:00:00Z'),'Asia/Tehran'),true);
  assert.equal(quietHours(new Date('2026-09-27T12:00:00Z'),'Asia/Tehran'),false);
});
test('sandbox adapter checks channel permission and deduplicates sends',async()=>{
  const sms=getAdapter('sms',{segmentCostMinor:3});
  const message={to:'+15551234567',body:'hello',idempotencyKey:'job-1'};
  await assert.rejects(()=>sms.send(message,{active:false,channel:'sms'}));
  const result=await sms.send(message,{active:true,channel:'sms'});
  assert.equal(result.status,'accepted');assert.equal(result.estimate.costMinor,3);
  const duplicate=await sms.send(message,{active:true,channel:'sms'});assert.equal(duplicate.providerMessageId,result.providerMessageId);assert.equal(duplicate.deduplicated,true);
  assert.equal(sms.simulateStatus('job-1','delivered').status,'delivered');assert.throws(()=>sms.simulateStatus('job-1','accepted'));
});
test('WhatsApp and push sandbox enforce prerequisites',async()=>{
  const whatsapp=getAdapter('whatsapp');await assert.rejects(()=>whatsapp.send({to:'sandbox',body:'hi',idempotencyKey:'1'},{active:true,channel:'whatsapp'}));
  const push=getAdapter('push');await assert.rejects(()=>push.send({to:'sandbox',body:'hi',idempotencyKey:'1'},{active:true,channel:'push'}));
});
