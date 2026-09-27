import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { extname, join } from 'node:path';
import { openDatabase, transaction, one, all, run, audit, outbox, postLedger, balance, seed } from './db.mjs';
import { id, now, money, allowed, validateDestination, transition, campaignTransitions, bookingTransitions, amounts } from '../../packages/domain/core.mjs';
import { getAdapter, normalizeE164, quietHours } from '../../packages/integrations/messaging.mjs';

const db = openDatabase();
if (process.env.DEMO_MODE !== 'false') seed(db);
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4300);
const base = process.env.PUBLIC_BASE_URL || `http://${host}:${port}`;
const webRoot = fileURLToPath(new URL('../web/', import.meta.url));
const smsAdapter=getAdapter('sms');

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const hash = (value) => createHash('sha256').update(value).digest('hex');
const contactHash = (value) => createHmac('sha256',process.env.CONTACT_HASH_KEY||'relay-local-demo-only').update(value).digest('hex');
const json = (res, status, value) => { res.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}); res.end(JSON.stringify(value)); };
const fail = (status, message) => { throw new HttpError(status, message); };
function safeDestination(value, hosts) { try { return validateDestination(value, hosts); } catch(error) { fail(400,error.message); } }
function safeTransition(current, next, map) { try { return transition(current,next,map); } catch(error) { fail(409,error.message); } }
function body(req) { return new Promise((resolve,reject) => { let value=''; req.on('data',chunk=>{ value+=chunk; if(value.length>65536){reject(new HttpError(413,'Request too large'));req.destroy();} }); req.on('end',()=>{try{resolve(value?JSON.parse(value):{});}catch{reject(new HttpError(400,'Invalid JSON'));}}); req.on('error',reject); }); }
function auth(req) {
  const token = /(?:^|; )relay_session=([^;]+)/.exec(req.headers.cookie || '')?.[1];
  if (!token) fail(401,'Sign in required');
  const user = one(db, `SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`, hash(token), now());
  if (!user) fail(401,'Session expired');
  return user;
}
function authConversionKey(req) {
  if(process.env.DEMO_MODE==='false') fail(503,'Sandbox keys disabled');
  const token=/^Bearer (rly_demo_[A-Za-z0-9_-]+)$/.exec(req.headers.authorization||'')?.[1];
  if(!token) fail(401,'Sandbox API key required');
  const key=one(db,"SELECT * FROM api_keys WHERE key_hash=? AND capability='conversion:write' AND expires_at>? AND revoked_at IS NULL",hash(token),now());
  if(!key) fail(401,'Invalid or expired sandbox API key');
  return {id:key.id,org_id:key.org_id,role:'advertiser'};
}
function requireRole(user, capability) { if (!allowed(user.role, capability)) fail(403,'Insufficient permission'); }
function visibleBooking(user, bookingId) {
  const booking = one(db, `SELECT b.*,i.name AS inventory_name,p.name AS property_name,c.name AS campaign_name FROM bookings b JOIN inventory i ON i.id=b.inventory_id JOIN properties p ON p.id=i.property_id JOIN campaigns c ON c.id=b.campaign_id WHERE b.id=? AND (b.advertiser_org_id=? OR b.owner_org_id=? OR ?='operator')`, bookingId,user.org_id,user.org_id,user.role);
  if (!booking) fail(404,'Booking not found'); return booking;
}
function sameOrigin(req) {
  const origin=req.headers.origin;
  if (origin && origin!==base) fail(403,'Origin mismatch');
}
function safeText(value,max=160) { if(typeof value!=='string'||!value.trim()||value.length>max) fail(400,`Expected text up to ${max} characters`); return value.trim(); }
function safeProof(value) { if(typeof value!=='string'||value.length>2048) fail(400,'Valid HTTPS proof URL required');let url;try{url=new URL(value);}catch{fail(400,'Valid HTTPS proof URL required');}if(url.protocol!=='https:'||url.username||url.password)fail(400,'Valid HTTPS proof URL required');return url.toString(); }
function safePhone(value) { try{return normalizeE164(value);}catch(error){fail(400,error.message);} }
function safeZone(value) { const zone=value||'UTC';try{quietHours(new Date(),zone);}catch{fail(400,'Invalid IANA time zone');}return zone; }
function currency(value) { if(!/^[A-Z]{3}$/.test(value||'')) fail(400,'Currency must be ISO 4217 code'); return value; }
function event(db, orgId, bookingId, type, provenance, metadata={}, anonymousId=null, occurredAt=now()) { const eventId=id('ev'); run(db,'INSERT INTO events(id,org_id,booking_id,type,provenance,occurred_at,received_at,anonymous_id,metadata) VALUES(?,?,?,?,?,?,?,?,?)',eventId,orgId,bookingId,type,provenance,occurredAt,now(),anonymousId,JSON.stringify(metadata)); return eventId; }

async function api(req,res,path) {
  const method=req.method;
  if(path==='/api/health') return json(res,200,{status:'ok',mode:process.env.DEMO_MODE==='false'?'disabled':'demo',time:now()});
  if(path==='/api/demo-users'&&method==='GET') {
    if(process.env.DEMO_MODE==='false') fail(404,'Demo disabled');
    return json(res,200,all(db,'SELECT id,name,email,role FROM users ORDER BY role'));
  }
  if(path==='/api/login'&&method==='POST') {
    if(process.env.DEMO_MODE==='false') fail(503,'Production authentication is not configured');
    sameOrigin(req); const data=await body(req);
    const user=one(db,'SELECT id,name,email,org_id,role FROM users WHERE id=?',data.userId);
    if(!user) fail(401,'Unknown demo user');
    const token=randomBytes(32).toString('base64url');
    run(db,'INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)',hash(token),user.id,new Date(Date.now()+8*3600000).toISOString());
    res.setHeader('set-cookie',`relay_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${base.startsWith('https:')?'; Secure':''}`);
    return json(res,200,user);
  }
  const viaApiKey=path==='/api/conversions'&&Boolean(req.headers.authorization);
  const user=viaApiKey?authConversionKey(req):auth(req);
  if(method!=='GET'&&method!=='HEAD'&&!viaApiKey) sameOrigin(req);
  if(path==='/api/me'&&method==='GET') return json(res,200,{id:user.id,name:user.name,email:user.email,orgId:user.org_id,role:user.role});
  if(path==='/api/logout'&&method==='POST') { const token=/(?:^|; )relay_session=([^;]+)/.exec(req.headers.cookie||'')?.[1]; run(db,'DELETE FROM sessions WHERE token_hash=?',hash(token));res.setHeader('set-cookie','relay_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(res,200,{ok:true}); }
  if(path==='/api/keys'&&method==='POST') {
    requireRole(user,'campaign:write');if(process.env.DEMO_MODE==='false') fail(503,'Sandbox key issuance disabled');
    const token=`rly_demo_${randomBytes(32).toString('base64url')}`,keyId=id('key');
    transaction(db,()=>{run(db,'INSERT INTO api_keys(id,org_id,key_hash,capability,expires_at,created_at) VALUES(?,?,?,?,?,?)',keyId,user.org_id,hash(token),'conversion:write',new Date(Date.now()+30*86400000).toISOString(),now());audit(db,user.id,user.org_id,'api_key.created',keyId,{capability:'conversion:write'});});
    return json(res,201,{id:keyId,token,capability:'conversion:write',mode:'sandbox',note:'Shown once. Store only in a local test secret store.'});
  }
  if(path==='/api/permissions'&&method==='GET') {
    requireRole(user,'campaign:write');return json(res,200,all(db,'SELECT id,channel,purpose,status,proof_source,captured_at,withdrawn_at FROM contact_permissions WHERE org_id=? ORDER BY captured_at DESC LIMIT 100',user.org_id));
  }
  if(path==='/api/permissions'&&method==='POST') {
    requireRole(user,'campaign:write');if(process.env.DEMO_MODE==='false')fail(503,'Sandbox messaging disabled');
    const data=await body(req),phone=safePhone(data.to),purpose=safeText(data.purpose,80),proofSource=safeText(data.proofSource,100),proofText=safeText(data.proofText,1000);
    if(data.channel!=='sms')fail(400,'Only SMS is wired to this sandbox endpoint');
    const digest=contactHash(phone),permissionId=id('perm');
    transaction(db,()=>{run(db,`INSERT INTO contact_permissions(id,org_id,contact_hash,channel,purpose,status,proof_source,proof_text,captured_at,withdrawn_at) VALUES(?,?,?,?,?,'active',?,?,?,NULL) ON CONFLICT(org_id,contact_hash,channel,purpose) DO UPDATE SET status='active',proof_source=excluded.proof_source,proof_text=excluded.proof_text,captured_at=excluded.captured_at,withdrawn_at=NULL`,permissionId,user.org_id,digest,'sms',purpose,proofSource,proofText,now());const current=one(db,"SELECT id FROM contact_permissions WHERE org_id=? AND contact_hash=? AND channel='sms' AND purpose=?",user.org_id,digest,purpose);run(db,'INSERT INTO permission_history(id,permission_id,org_id,action,proof_source,proof_text,created_at) VALUES(?,?,?,?,?,?,?)',id('permh'),current.id,user.org_id,'granted',proofSource,proofText,now());audit(db,user.id,user.org_id,'permission.granted',current.id,{channel:'sms',purpose});});
    return json(res,201,{status:'active',channel:'sms',purpose,mode:'sandbox'});
  }
  if(path==='/api/permissions/withdraw'&&method==='POST') {
    requireRole(user,'campaign:write');const data=await body(req),digest=contactHash(safePhone(data.to)),purpose=safeText(data.purpose,80);
    const result=transaction(db,()=>{const permission=one(db,"SELECT * FROM contact_permissions WHERE org_id=? AND contact_hash=? AND channel='sms' AND purpose=?",user.org_id,digest,purpose);if(!permission)fail(404,'Permission not found');if(permission.status==='withdrawn')return {status:'withdrawn',channel:'sms',purpose,deduplicated:true};run(db,"UPDATE contact_permissions SET status='withdrawn',withdrawn_at=? WHERE id=?",now(),permission.id);run(db,'INSERT INTO permission_history(id,permission_id,org_id,action,proof_source,proof_text,created_at) VALUES(?,?,?,?,?,?,?)',id('permh'),permission.id,user.org_id,'withdrawn','', '',now());audit(db,user.id,user.org_id,'permission.withdrawn',permission.id,{channel:'sms',purpose});return {status:'withdrawn',channel:'sms',purpose};});
    return json(res,200,result);
  }
  if(path==='/api/messages'&&method==='GET') {requireRole(user,'campaign:write');return json(res,200,all(db,'SELECT id,channel,purpose,status,provider_message_id,estimate_minor,currency,created_at,updated_at FROM messages WHERE org_id=? ORDER BY created_at DESC LIMIT 100',user.org_id));}
  if(path==='/api/messages/preflight'&&method==='POST') {
    requireRole(user,'campaign:write');const data=await body(req),phone=safePhone(data.to),purpose=safeText(data.purpose,80),zone=safeZone(data.timeZone);
    const permission=one(db,"SELECT status FROM contact_permissions WHERE org_id=? AND contact_hash=? AND channel='sms' AND purpose=?",user.org_id,contactHash(phone),purpose);
    let estimate;try{estimate=smsAdapter.estimate({body:data.body});}catch(error){fail(400,error.message);}
    return json(res,200,{channel:'sms',mode:'sandbox',eligible:permission?.status==='active'&&!quietHours(new Date(),zone),permission:permission?.status||'absent',quietHours:quietHours(new Date(),zone),estimate});
  }
  if(path==='/api/messages'&&method==='POST') {
    requireRole(user,'campaign:write');if(process.env.DEMO_MODE==='false')fail(503,'Sandbox messaging disabled');
    const data=await body(req),phone=safePhone(data.to),purpose=safeText(data.purpose,80),zone=safeZone(data.timeZone),key=safeText(data.idempotencyKey,100),messageBody=safeText(data.body,1600);
    const existing=one(db,'SELECT id,status,provider_message_id FROM messages WHERE org_id=? AND idempotency_key=?',user.org_id,key);if(existing)return json(res,200,{...existing,deduplicated:true,mode:'sandbox'});
    const permission=one(db,"SELECT status FROM contact_permissions WHERE org_id=? AND contact_hash=? AND channel='sms' AND purpose=?",user.org_id,contactHash(phone),purpose);
    if(permission?.status!=='active')fail(403,'Current SMS permission is required');
    if(quietHours(new Date(),zone))fail(409,'Quiet hours for contact time zone');
    const sent=await smsAdapter.send({to:phone,body:messageBody,idempotencyKey:`${user.org_id}:${key}`},{active:true,channel:'sms'});
    const messageId=id('msg');
    try{transaction(db,()=>{run(db,'INSERT INTO messages(id,org_id,contact_hash,channel,purpose,content_hash,idempotency_key,status,provider_message_id,estimate_minor,currency,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',messageId,user.org_id,contactHash(phone),'sms',purpose,hash(messageBody),key,sent.status,sent.providerMessageId,sent.estimate.costMinor,sent.estimate.currency,now(),now());audit(db,user.id,user.org_id,'message.sandbox_accepted',messageId,{channel:'sms'});outbox(db,user.org_id,'message.sandbox_accepted',{messageId});});}
    catch(error){const duplicate=one(db,'SELECT id,status,provider_message_id FROM messages WHERE org_id=? AND idempotency_key=?',user.org_id,key);if(duplicate)return json(res,200,{...duplicate,deduplicated:true,mode:'sandbox'});throw error;}
    return json(res,201,{id:messageId,status:sent.status,providerMessageId:sent.providerMessageId,mode:'sandbox',estimate:sent.estimate});
  }
  const messageStatus=/^\/api\/messages\/([^/]+)\/status$/.exec(path);
  if(messageStatus&&method==='POST') {
    requireRole(user,'review:write');const data=await body(req);
    if(!['delivered','failed'].includes(data.status))fail(400,'Only sandbox delivered/failed transitions are supported');
    const result=transaction(db,()=>{const message=one(db,'SELECT * FROM messages WHERE id=?',messageStatus[1]);if(!message)fail(404,'Message not found');if(message.status!=='accepted')fail(409,'Message status is final');run(db,'UPDATE messages SET status=?,updated_at=? WHERE id=?',data.status,now(),message.id);audit(db,user.id,user.org_id,'message.status_simulated',message.id,{status:data.status});return {id:message.id,status:data.status,provenance:'sandbox_provider_reported'};});
    return json(res,200,result);
  }
  if(path==='/api/catalog'&&method==='GET') return json(res,200,all(db,`SELECT i.*,p.name AS property_name,p.channel,p.description,p.verification,p.owner_org_id FROM inventory i JOIN properties p ON p.id=i.property_id WHERE i.availability='available' ORDER BY i.created_at DESC LIMIT 100`));
  if(path==='/api/properties'&&method==='GET') { requireRole(user,'property:write'); return json(res,200,all(db,'SELECT * FROM properties WHERE owner_org_id=? ORDER BY created_at DESC LIMIT 100',user.org_id)); }
  if(path==='/api/properties'&&method==='POST') {
    requireRole(user,'property:write'); const data=await body(req);
    const property={id:id('prop'),name:safeText(data.name),channel:safeText(data.channel,40),description:safeText(data.description,1000)};
    transaction(db,()=>{run(db,'INSERT INTO properties(id,owner_org_id,name,channel,description,verification,created_at) VALUES(?,?,?,?,?,?,?)',property.id,user.org_id,property.name,property.channel,property.description,'pending',now());audit(db,user.id,user.org_id,'property.created',property.id);outbox(db,user.org_id,'property.created',property);});
    return json(res,201,property);
  }
  if(path==='/api/inventory'&&method==='POST') {
    requireRole(user,'property:write'); const data=await body(req);
    const property=one(db,'SELECT * FROM properties WHERE id=? AND owner_org_id=?',data.propertyId,user.org_id);
    if(!property) fail(404,'Property not found'); if(!money(data.priceMinor)||data.priceMinor===0) fail(400,'Invalid price');
    const sku={id:id('sku'),name:safeText(data.name),format:safeText(data.format,60),priceMinor:data.priceMinor,currency:currency(data.currency)};
    transaction(db,()=>{run(db,'INSERT INTO inventory(id,property_id,name,format,price_minor,currency,availability,created_at) VALUES(?,?,?,?,?,?,?,?)',sku.id,property.id,sku.name,sku.format,sku.priceMinor,sku.currency,'available',now());audit(db,user.id,user.org_id,'inventory.created',sku.id);});
    return json(res,201,sku);
  }
  if(path==='/api/campaigns'&&method==='GET') {requireRole(user,'report:read');return json(res,200,all(db,'SELECT * FROM campaigns WHERE advertiser_org_id=? ORDER BY created_at DESC LIMIT 100',user.org_id));}
  if(path==='/api/campaigns'&&method==='POST') {
    requireRole(user,'campaign:write'); const data=await body(req);
    if(!money(data.budgetMinor)||data.budgetMinor===0) fail(400,'Invalid budget');
    const allowedHosts=(process.env.ALLOWED_DESTINATION_HOSTS||'example.com').split(',').map(x=>x.trim().toLowerCase());
    const campaign={id:id('camp'),name:safeText(data.name),objective:safeText(data.objective,40),budgetMinor:data.budgetMinor,currency:currency(data.currency),destination:safeDestination(data.destination,allowedHosts)};
    transaction(db,()=>{run(db,'INSERT INTO campaigns(id,advertiser_org_id,name,objective,status,budget_minor,currency,destination,created_at) VALUES(?,?,?,?,?,?,?,?,?)',campaign.id,user.org_id,campaign.name,campaign.objective,'draft',campaign.budgetMinor,campaign.currency,campaign.destination,now());audit(db,user.id,user.org_id,'campaign.created',campaign.id);outbox(db,user.org_id,'campaign.created',campaign);});
    return json(res,201,{...campaign,status:'draft'});
  }
  const campaignStatus=/^\/api\/campaigns\/([^/]+)\/status$/.exec(path);
  if(campaignStatus&&method==='POST') {
    const data=await body(req); const campaign=one(db,'SELECT * FROM campaigns WHERE id=? AND advertiser_org_id=?',campaignStatus[1],user.org_id);
    if(!campaign) fail(404,'Campaign not found'); requireRole(user,'campaign:write');
    const next=safeTransition(campaign.status,data.status,campaignTransitions);
    if(next==='approved') fail(403,'Operator review is required');
    transaction(db,()=>{run(db,'UPDATE campaigns SET status=? WHERE id=?',next,campaign.id);audit(db,user.id,user.org_id,'campaign.status',campaign.id,{from:campaign.status,to:next});});
    return json(res,200,{id:campaign.id,status:next});
  }
  if(path==='/api/review'&&method==='GET') {requireRole(user,'review:write');return json(res,200,{campaigns:all(db,"SELECT * FROM campaigns WHERE status='submitted' LIMIT 100"),properties:all(db,"SELECT * FROM properties WHERE verification='pending' LIMIT 100")});}
  if(path==='/api/diagnostics'&&method==='GET') {
    requireRole(user,'review:write');
    const outbox=one(db,'SELECT COUNT(*) AS count,MIN(created_at) AS oldest FROM outbox WHERE processed_at IS NULL');
    const unbalanced=one(db,'SELECT COUNT(*) AS count FROM (SELECT batch_id FROM ledger_entries GROUP BY batch_id HAVING SUM(amount)<>0)');
    const disputes=one(db,"SELECT COUNT(*) AS count FROM bookings WHERE status='disputed'");
    return json(res,200,{asOf:now(),mode:'sandbox',outbox:{unprocessed:outbox.count,oldest:outbox.oldest,consumer:'not_configured'},ledger:{unbalancedBatches:unbalanced.count},disputes:disputes.count});
  }
  if(path==='/api/review'&&method==='POST') {
    requireRole(user,'review:write'); const data=await body(req); const decision=data.decision==='approve'?'approved':'rejected';
    if(data.kind==='campaign') {const campaign=one(db,'SELECT * FROM campaigns WHERE id=? AND status=?',data.id,'submitted');if(!campaign) fail(404,'Submitted campaign not found');transaction(db,()=>{run(db,'UPDATE campaigns SET status=? WHERE id=?',decision==='approved'?'approved':'draft',campaign.id);audit(db,user.id,user.org_id,'campaign.review',campaign.id,{decision});});}
    else if(data.kind==='property') {const property=one(db,'SELECT * FROM properties WHERE id=? AND verification=?',data.id,'pending');if(!property) fail(404,'Pending property not found');transaction(db,()=>{run(db,'UPDATE properties SET verification=? WHERE id=?',decision==='approved'?'manual_review':'rejected',property.id);audit(db,user.id,user.org_id,'property.review',property.id,{decision});});}
    else fail(400,'Unknown review kind');
    return json(res,200,{ok:true,decision});
  }
  if(path==='/api/bookings'&&method==='GET') {
    requireRole(user,'report:read'); const scope=user.role==='operator'?'1=1':user.role==='owner'?'b.owner_org_id=?':'b.advertiser_org_id=?';
    const args=user.role==='operator'?[]:[user.org_id];
    const bookings=all(db,`SELECT b.*,c.name AS campaign_name,i.name AS inventory_name,p.name AS property_name,(SELECT token FROM tracking_links t WHERE t.booking_id=b.id ORDER BY created_at DESC LIMIT 1) AS tracking_token FROM bookings b JOIN campaigns c ON c.id=b.campaign_id JOIN inventory i ON i.id=b.inventory_id JOIN properties p ON p.id=i.property_id WHERE ${scope} ORDER BY b.created_at DESC LIMIT 100`,...args);
    return json(res,200,bookings.map(({tracking_token,...booking})=>({...booking,tracking_url:tracking_token?`${base}/r/${tracking_token}`:null})));
  }
  if(path==='/api/bookings'&&method==='POST') {
    requireRole(user,'booking:write'); const data=await body(req);
    const result=transaction(db,()=>{
      const campaign=one(db,'SELECT * FROM campaigns WHERE id=? AND advertiser_org_id=?',data.campaignId,user.org_id);
      if(!campaign) fail(404,'Campaign not found'); if(campaign.status!=='approved') fail(409,'Campaign must be approved');
      const sku=one(db,`SELECT i.*,p.owner_org_id,p.verification FROM inventory i JOIN properties p ON p.id=i.property_id WHERE i.id=?`,data.inventoryId);
      if(!sku||sku.verification!=='manual_review'||sku.availability!=='available') fail(409,'Inventory unavailable or unverified');
      if(sku.currency!==campaign.currency) fail(409,'Currency mismatch');
      const used=one(db,"SELECT COALESCE(SUM(price_minor),0) AS amount FROM bookings WHERE campaign_id=? AND status NOT IN ('cancelled')",campaign.id).amount;
      if(used+sku.price_minor>campaign.budget_minor) fail(409,'Campaign budget exceeded');
      if(balance(db,user.org_id,'advertiser_available',campaign.currency)<sku.price_minor) fail(409,'Insufficient sandbox funds');
      const booking={id:id('book'),campaignId:campaign.id,inventoryId:sku.id,priceMinor:sku.price_minor,currency:sku.currency,status:'reserved'};
      run(db,'INSERT INTO bookings(id,campaign_id,inventory_id,owner_org_id,advertiser_org_id,status,price_minor,currency,created_at) VALUES(?,?,?,?,?,?,?,?,?)',booking.id,campaign.id,sku.id,sku.owner_org_id,user.org_id,'reserved',sku.price_minor,sku.currency,now());
      run(db,"UPDATE inventory SET availability='reserved' WHERE id=?",sku.id);
      run(db,"UPDATE campaigns SET status='booked' WHERE id=?",campaign.id);
      postLedger(db,user.org_id,`reserve:${booking.id}`,sku.currency,[{account:'advertiser_available',amount:-sku.price_minor},{account:'booking_escrow',amount:sku.price_minor}]);
      audit(db,user.id,user.org_id,'booking.reserved',booking.id);outbox(db,user.org_id,'booking.reserved',booking);
      return booking;
    }); return json(res,201,result);
  }
  const bookingAction=/^\/api\/bookings\/([^/]+)\/(accept|publish|dispute|resolve|settle|cancel|invoice)$/.exec(path);
  if(bookingAction) {
    const booking=visibleBooking(user,bookingAction[1]);const action=bookingAction[2];
    if(action==='invoice'&&method==='GET') { const {fee,payable}=amounts(booking.price_minor);return json(res,200,{invoiceNumber:`SANDBOX-${booking.id}`,bookingId:booking.id,campaign:booking.campaign_name,inventory:booking.inventory_name,currency:booking.currency,totalMinor:booking.price_minor,platformFeeMinor:fee,ownerPayableMinor:payable,status:booking.status,mode:'sandbox'}); }
    if(method!=='POST') fail(405,'Method not allowed'); const data=await body(req);
    let target;
    if(action==='accept'&&user.org_id===booking.owner_org_id&&user.role==='owner') target='accepted';
    else if(action==='publish'&&user.org_id===booking.owner_org_id&&user.role==='owner') target='published';
    else if(action==='dispute'&&(user.org_id===booking.advertiser_org_id||user.org_id===booking.owner_org_id)) target='disputed';
    else if(action==='resolve'&&user.role==='operator') target='published';
    else if(action==='settle'&&user.role==='operator') target='settled';
    else if(action==='cancel'&&user.role==='operator') target='cancelled';
    else fail(403,'Action not permitted');
    safeTransition(booking.status,target,bookingTransitions);
    const proofUrl=action==='publish'?safeProof(data.proofUrl):null;
    const result=transaction(db,()=>{
      if(action==='settle') {
        if(!booking.proof_url) fail(409,'Publication proof required');
        const {fee,payable}=amounts(booking.price_minor);
        postLedger(db,booking.advertiser_org_id,`settle:${booking.id}`,booking.currency,[{account:'booking_escrow',amount:-booking.price_minor},{account:`owner_payable:${booking.owner_org_id}`,amount:payable},{account:'platform_fee',amount:fee}]);
        postLedger(db,booking.owner_org_id,`receivable:${booking.id}`,booking.currency,[{account:'owner_receivable',amount:payable},{account:'marketplace_clearing',amount:-payable}]);
      }
      if(action==='cancel') {postLedger(db,booking.advertiser_org_id,`refund:${booking.id}`,booking.currency,[{account:'booking_escrow',amount:-booking.price_minor},{account:'advertiser_available',amount:booking.price_minor}]);run(db,"UPDATE inventory SET availability='available' WHERE id=?",booking.inventory_id);run(db,"UPDATE campaigns SET status='approved' WHERE id=?",booking.campaign_id);}
      run(db,'UPDATE bookings SET status=?,proof_url=COALESCE(?,proof_url),proof_type=COALESCE(?,proof_type),published_at=CASE WHEN ?=\'published\' THEN ? ELSE published_at END,settled_at=CASE WHEN ?=\'settled\' THEN ? ELSE settled_at END WHERE id=?',target,proofUrl,action==='publish'?'owner_reported':null,target,now(),target,now(),booking.id);
      if(action==='publish') run(db,"UPDATE campaigns SET status='live' WHERE id=?",booking.campaign_id);
      if(action==='settle') run(db,"UPDATE campaigns SET status='settled' WHERE id=?",booking.campaign_id);
      audit(db,user.id,user.org_id,`booking.${action}`,booking.id,{from:booking.status,to:target,proofType:action==='publish'?'owner_reported':undefined});outbox(db,booking.advertiser_org_id,`booking.${action}`,{bookingId:booking.id});
      if(action==='publish') {
        const token=randomBytes(24).toString('base64url'); const destination=one(db,'SELECT destination FROM campaigns WHERE id=?',booking.campaign_id).destination;
        run(db,'INSERT INTO tracking_links(token,booking_id,advertiser_org_id,destination,expires_at,created_at) VALUES(?,?,?,?,?,?)',token,booking.id,booking.advertiser_org_id,destination,new Date(Date.now()+30*86400000).toISOString(),now());
        return {id:booking.id,status:target,trackingUrl:`${base}/r/${token}`,proofProvenance:'owner_reported'};
      }
      return {id:booking.id,status:target};
    }); return json(res,200,result);
  }
  if(path==='/api/conversions'&&method==='POST') {
    requireRole(user,'campaign:write'); const data=await body(req);
    const booking=visibleBooking(user,data.bookingId);if(booking.advertiser_org_id!==user.org_id||!['published','settled'].includes(booking.status)) fail(409,'Booking not published');
    const eventId=safeText(data.eventId,100),stage=safeText(data.stage,30);
    if(!['lead','qualified','opportunity','won','lost','refunded'].includes(stage)) fail(400,'Unknown conversion stage');
    const value=data.valueMinor??0;if(!money(value)) fail(400,'Invalid value');
    let occurredAt=now();
    if(viaApiKey){
      if(!data.occurredAt||!['granted','not_required'].includes(data.consentSignal))fail(400,'occurredAt and consentSignal required for server imports');
      const timestamp=Date.parse(data.occurredAt);
      if(!Number.isFinite(timestamp)||timestamp>Date.now()+300000||timestamp<Date.now()-90*86400000)fail(400,'Event time outside allowed window');
      occurredAt=new Date(timestamp).toISOString();
    }
    const result=transaction(db,()=>{
      const existing=one(db,'SELECT * FROM conversions WHERE org_id=? AND event_id=?',user.org_id,eventId);if(existing) return {id:existing.id,deduplicated:true};
      const conversionId=id('conv');run(db,'INSERT INTO conversions(id,org_id,booking_id,event_id,stage,value_minor,currency,provenance,created_at) VALUES(?,?,?,?,?,?,?,?,?)',conversionId,user.org_id,booking.id,eventId,stage,value,booking.currency,'imported',now());
      event(db,user.org_id,booking.id,'conversion','imported',{stage,valueMinor:value,eventId,consentSignal:data.consentSignal||'unverified'},null,occurredAt);audit(db,user.id,user.org_id,'conversion.imported',conversionId,{viaApiKey});return {id:conversionId,deduplicated:false,attribution:'booking_scoped_claim'};
    });return json(res,201,result);
  }
  if(path==='/api/report'&&method==='GET') {
    requireRole(user,'report:read');
    const scope=user.role==='operator'?'1=1':user.role==='owner'?'b.owner_org_id=?':'b.advertiser_org_id=?';const args=user.role==='operator'?[]:[user.org_id];
    const rows=all(db,`SELECT b.id,b.status,b.price_minor,b.currency,c.name AS campaign,i.name AS inventory,p.channel,(SELECT COUNT(*) FROM events e WHERE e.booking_id=b.id AND e.type='click') AS clicks,(SELECT COUNT(*) FROM conversions cv WHERE cv.booking_id=b.id AND cv.stage='qualified') AS qualified_leads FROM bookings b JOIN campaigns c ON c.id=b.campaign_id JOIN inventory i ON i.id=b.inventory_id JOIN properties p ON p.id=i.property_id WHERE ${scope} ORDER BY b.created_at DESC LIMIT 100`,...args);
    return json(res,200,{asOf:now(),timezone:'UTC',mode:'sandbox',rows,definitions:{clicks:{source:'platform_observed',definition:'Non-prefetch redirect requests; anonymous and not landing sessions'},qualified_leads:{source:'imported',definition:'Advertiser-submitted qualified conversion events; booking-scoped claim'},price_minor:{source:'ledger_contract',definition:'Booked price in currency minor units'}}});
  }
  if(path==='/api/finance'&&method==='GET') {
    requireRole(user,'finance:read'); const scope=user.role==='operator'?'1=1':'org_id=?';const args=user.role==='operator'?[]:[user.org_id];
    return json(res,200,{entries:all(db,`SELECT batch_id,org_id,account,amount,currency,ref,created_at FROM ledger_entries WHERE ${scope} ORDER BY created_at DESC LIMIT 100`,...args),mode:'sandbox'});
  }
  if(path==='/api/reconciliation'&&method==='GET') {
    requireRole(user,'review:write');
    const bookings=all(db,'SELECT id,advertiser_org_id,owner_org_id,status,price_minor,currency,proof_url FROM bookings ORDER BY created_at DESC LIMIT 100');
    const rows=bookings.map(booking=>{
      const reserved=all(db,'SELECT account,amount FROM ledger_entries WHERE org_id=? AND ref=?',booking.advertiser_org_id,`reserve:${booking.id}`);
      const settled=all(db,'SELECT account,amount FROM ledger_entries WHERE org_id=? AND ref=?',booking.advertiser_org_id,`settle:${booking.id}`);
      const owner=all(db,'SELECT account,amount FROM ledger_entries WHERE org_id=? AND ref=?',booking.owner_org_id,`receivable:${booking.id}`);
      const refunded=all(db,'SELECT account,amount FROM ledger_entries WHERE org_id=? AND ref=?',booking.advertiser_org_id,`refund:${booking.id}`);
      const issues=[];const expected=amounts(booking.price_minor);
      const amount=(entries,account)=>entries.find(entry=>entry.account===account)?.amount;
      if(amount(reserved,'advertiser_available')!==-booking.price_minor||amount(reserved,'booking_escrow')!==booking.price_minor)issues.push('reservation_ledger_mismatch');
      if(['published','disputed','settled'].includes(booking.status)&&!booking.proof_url)issues.push('publication_proof_missing');
      if(booking.status==='settled'){
        if(amount(settled,'booking_escrow')!==-booking.price_minor||amount(settled,'platform_fee')!==expected.fee||amount(settled,`owner_payable:${booking.owner_org_id}`)!==expected.payable)issues.push('settlement_ledger_mismatch');
        if(amount(owner,'owner_receivable')!==expected.payable)issues.push('owner_receivable_mismatch');
      } else if(settled.length) issues.push('unexpected_settlement');
      if(booking.status==='cancelled'&&(amount(refunded,'advertiser_available')!==booking.price_minor||amount(refunded,'booking_escrow')!==-booking.price_minor))issues.push('refund_ledger_mismatch');
      return {bookingId:booking.id,status:booking.status,currency:booking.currency,priceMinor:booking.price_minor,proofSource:booking.proof_url?'owner_reported':null,issues};
    });
    return json(res,200,{asOf:now(),mode:'internal_sandbox_only',rows,discrepancyCount:rows.reduce((sum,row)=>sum+row.issues.length,0),externalProvidersReconciled:false});
  }
  if(path==='/api/activity'&&method==='GET') {requireRole(user,'report:read');const scope=user.role==='operator'?'1=1':'org_id=?';const args=user.role==='operator'?[]:[user.org_id];return json(res,200,all(db,`SELECT action,target_id,created_at FROM audit_log WHERE ${scope} ORDER BY created_at DESC LIMIT 30`,...args));}
  fail(404,'Endpoint not found');
}

function redirect(req,res,path) {
  const token=path.split('/')[2];if(!/^[A-Za-z0-9_-]{32}$/.test(token||'')) fail(404,'Link not found');
  const link=one(db,'SELECT * FROM tracking_links WHERE token=? AND expires_at>?',token,now());if(!link) fail(404,'Link expired or not found');
  const booking=one(db,'SELECT status FROM bookings WHERE id=?',link.booking_id);if(!booking||!['published','settled'].includes(booking.status)) fail(404,'Link unavailable');
  if(req.method==='GET'&&!/(bot|crawler|spider|preview|prefetch)/i.test(req.headers['user-agent']||'')&&req.headers.purpose!=='prefetch'&&req.headers['sec-purpose']!=='prefetch') {
    try { transaction(db,()=>event(db,link.advertiser_org_id,link.booking_id,'click','platform_observed',{userAgentClass:'browser'},null)); } catch(error) { console.error(JSON.stringify({level:'error',event:'click_write_failed',message:error.message})); }
  }
  res.writeHead(302,{location:link.destination,'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'});res.end();
}
function staticFile(req,res,path) {
  const file=path==='/'?'index.html':path.slice(1);if(!['index.html','app.js','styles.css'].includes(file)) fail(404,'Not found');
  const type={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'}[extname(file)];
  res.writeHead(200,{'content-type':type,'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",'x-content-type-options':'nosniff','referrer-policy':'no-referrer'});res.end(readFileSync(join(webRoot,file)));
}
export const server=http.createServer(async(req,res)=>{try{const path=new URL(req.url,base).pathname;if(path.startsWith('/api/v1/')) await api(req,res,path.replace('/api/v1/','/api/'));else if(path.startsWith('/api/')) await api(req,res,path);else if(path.startsWith('/r/')) redirect(req,res,path);else staticFile(req,res,path);}catch(error){const status=error.status||500;if(status===500) console.error(JSON.stringify({level:'error',event:'request_failed',message:error.message}));if(!res.headersSent) json(res,status,{error:status===500?'Internal server error':error.message});else res.end();}});
if(process.env.NODE_ENV!=='test') server.listen(port,host,()=>console.log(`Relay demo listening on ${base}`));
