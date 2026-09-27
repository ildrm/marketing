import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { id, now } from '../../packages/domain/core.mjs';

export function openDatabase(path = process.env.DB_PATH || './data/relay.sqlite') {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  db.exec(readFileSync(new URL('../../infra/migrations/001_init.sql', import.meta.url), 'utf8'));
  return db;
}
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
export const one = (db, sql, ...args) => db.prepare(sql).get(...args);
export const all = (db, sql, ...args) => db.prepare(sql).all(...args);
export const run = (db, sql, ...args) => db.prepare(sql).run(...args);
export function audit(db, actorId, orgId, action, targetId, detail = {}) {
  run(db, 'INSERT INTO audit_log(id, actor_id, org_id, action, target_id, detail, created_at) VALUES(?,?,?,?,?,?,?)', id('aud'), actorId, orgId, action, targetId, JSON.stringify(detail), now());
}
export function outbox(db, orgId, type, payload) {
  run(db, 'INSERT INTO outbox(id, org_id, type, version, payload, created_at) VALUES(?,?,?,?,?,?)', id('evt'), orgId, type, 1, JSON.stringify(payload), now());
}
export function postLedger(db, orgId, ref, currency, postings) {
  if (postings.reduce((sum, p) => sum + p.amount, 0) !== 0) throw new Error('Unbalanced ledger posting');
  if (!postings.every((p) => Number.isSafeInteger(p.amount) && p.amount !== 0)) throw new Error('Invalid ledger amount');
  const existing = one(db, 'SELECT id FROM ledger_entries WHERE org_id=? AND ref=? LIMIT 1', orgId, ref);
  if (existing) return false;
  const batch = id('batch');
  for (const p of postings) run(db, 'INSERT INTO ledger_entries(id,batch_id,org_id,account,amount,currency,ref,created_at) VALUES(?,?,?,?,?,?,?,?)', id('le'), batch, orgId, p.account, p.amount, currency, ref, now());
  return true;
}
export function balance(db, orgId, account, currency) {
  return one(db, 'SELECT COALESCE(SUM(amount),0) AS balance FROM ledger_entries WHERE org_id=? AND account=? AND currency=?', orgId, account, currency).balance;
}
export function seed(db) {
  if (one(db, 'SELECT id FROM organizations LIMIT 1')) return;
  transaction(db, () => {
    const advertiser = 'org_demo_advertiser', owner = 'org_demo_owner', platform = 'org_demo_platform';
    for (const [orgId, name, type] of [[advertiser, 'Northstar Studio', 'advertiser'], [owner, 'City Letter', 'owner'], [platform, 'Relay Operations', 'platform']]) run(db, 'INSERT INTO organizations(id,name,type,created_at) VALUES(?,?,?,?)', orgId, name, type, now());
    for (const [userId, name, email, orgId, role] of [['usr_advertiser','Ava Chen','advertiser@relay.demo',advertiser,'advertiser'],['usr_owner','Mina Darvish','owner@relay.demo',owner,'owner'],['usr_operator','Sam Reed','operator@relay.demo',platform,'operator']]) run(db, 'INSERT INTO users(id,name,email,org_id,role,created_at) VALUES(?,?,?,?,?,?)', userId,name,email,orgId,role,now());
    run(db, 'INSERT INTO properties(id,owner_org_id,name,channel,description,verification,created_at) VALUES(?,?,?,?,?,?,?)', 'prop_cityletter',owner,'City Letter Weekly','newsletter','A weekly city culture newsletter. Demo inventory only.','manual_review',now());
    run(db, 'INSERT INTO inventory(id,property_id,name,format,price_minor,currency,availability,created_at) VALUES(?,?,?,?,?,?,?,?)','sku_cityletter', 'prop_cityletter','Sponsored section','newsletter_section',12000,'USD','available',now());
    postLedger(db, advertiser, 'demo_credit', 'USD', [{account:'advertiser_available',amount:100000},{account:'sandbox_funding',amount:-100000}]);
  });
}
