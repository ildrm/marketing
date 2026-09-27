import test from 'node:test';
import assert from 'node:assert/strict';
import { amounts, validateDestination, transition, campaignTransitions, bookingTransitions } from '../packages/domain/core.mjs';
import { openDatabase, postLedger, balance, transaction, one } from '../apps/api/db.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('destination allowlist rejects unsafe targets',()=>{
  assert.equal(validateDestination('https://example.com/offer',['example.com']),'https://example.com/offer');
  for(const url of ['http://example.com/offer','https://evil.example/','https://example.com.evil.test/','https://user:pass@example.com/']) assert.throws(()=>validateDestination(url,['example.com']));
});
test('state machines reject invalid transitions',()=>{
  assert.equal(transition('draft','submitted',campaignTransitions),'submitted');
  assert.throws(()=>transition('draft','settled',campaignTransitions));
  assert.throws(()=>transition('reserved','settled',bookingTransitions));
});
test('money splits exactly, with no fractional minor units',()=>{
  assert.deepEqual(amounts(101),{price:101,fee:15,payable:86});
  assert.throws(()=>amounts(1.2));
});
test('ledger batches balance, are idempotent, and preserve currency',()=>{
  const dir=mkdtempSync(join(tmpdir(),'relay-ledger-'));const db=openDatabase(join(dir,'test.sqlite'));
  try{
    db.prepare('INSERT INTO organizations(id,name,type,created_at) VALUES(?,?,?,?)').run('org','Test','advertiser',new Date().toISOString());
    transaction(db,()=>assert.equal(postLedger(db,'org','credit','USD',[{account:'cash',amount:1000},{account:'source',amount:-1000}]),true));
    transaction(db,()=>assert.equal(postLedger(db,'org','credit','USD',[{account:'cash',amount:1000},{account:'source',amount:-1000}]),false));
    assert.equal(balance(db,'org','cash','USD'),1000);assert.equal(balance(db,'org','cash','EUR'),0);
    assert.throws(()=>transaction(db,()=>postLedger(db,'org','bad','USD',[{account:'cash',amount:5},{account:'source',amount:-4}])));
    assert.equal(one(db,'SELECT SUM(amount) AS total FROM ledger_entries WHERE org_id=?','org').total,0);
    assert.throws(()=>db.prepare('DELETE FROM ledger_entries WHERE org_id=?').run('org'));
  }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
