import { randomBytes } from 'node:crypto';

const GSM_BASIC = new Set([..."@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"]);
const GSM_EXTENDED = new Set([...'^{}\\[~]|€']);

export function normalizeE164(phone) {
  if (typeof phone !== 'string') throw new Error('Phone must be a string');
  const clean = phone.replace(/[\s().-]/g,'');
  if (!/^\+[1-9]\d{7,14}$/.test(clean)) throw new Error('A valid E.164 phone number is required');
  return clean;
}
export function smsSegments(body) {
  if (typeof body !== 'string' || !body.length) throw new Error('SMS body is required');
  let septets=0, gsm=true;
  for (const character of body) { if (GSM_BASIC.has(character)) septets++; else if (GSM_EXTENDED.has(character)) septets+=2; else { gsm=false; break; } }
  if (gsm) return {encoding:'GSM-7',units:septets,segments:septets<=160?1:Math.ceil(septets/153)};
  const units=[...body].reduce((n,c)=>n+(c.codePointAt(0)>0xFFFF?2:1),0);
  return {encoding:'UCS-2',units,segments:units<=70?1:Math.ceil(units/67)};
}
export function quietHours(date, timeZone, start=21, end=9) {
  const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone,hour:'2-digit',hourCycle:'h23'}).format(date));
  return start>end ? hour>=start||hour<end : hour>=start&&hour<end;
}
export class SandboxChannelAdapter {
  constructor(channel, options={}) { this.channel=channel;this.options=options;this.messages=new Map(); }
  capabilities() { return {channel:this.channel,mode:'sandbox',outbound:true,deliveryReceipts:this.channel==='sms'||this.channel==='whatsapp',readReceipts:false,region:'test-only',providerCostMinor:0}; }
  estimate(message) { if(this.channel==='sms') {const split=smsSegments(message.body);return {...split,costMinor:split.segments*(this.options.segmentCostMinor??0),currency:this.options.currency??'USD',source:'sandbox_config'};}return {costMinor:0,currency:this.options.currency??'USD',source:'sandbox_config'}; }
  async send(message, permission) {
    if(!permission?.active||permission.channel!==this.channel) throw new Error('Current channel permission is required');
    if(this.channel==='sms') normalizeE164(message.to);
    if(this.channel==='whatsapp'&&!message.approvedTemplate) throw new Error('Approved template required in sandbox');
    if(this.channel==='push'&&!message.devicePermission) throw new Error('Push permission required');
    if(!message.idempotencyKey) throw new Error('Idempotency key required');
    const existing=this.messages.get(message.idempotencyKey);if(existing)return {...existing,deduplicated:true};
    const result={providerMessageId:`sandbox_${this.channel}_${randomBytes(8).toString('hex')}`,status:'accepted',provenance:'sandbox_provider_reported',channel:this.channel,deduplicated:false,estimate:this.estimate(message)};
    this.messages.set(message.idempotencyKey,result);return result;
  }
  simulateStatus(key,status) {
    const current=this.messages.get(key);if(!current)throw new Error('Unknown message');
    const permitted={accepted:['delivered','failed'],delivered:[],failed:[]};
    if(!permitted[current.status]?.includes(status))throw new Error('Invalid status transition');
    const updated={...current,status};this.messages.set(key,updated);return updated;
  }
}
export function getAdapter(channel,config={}) {
  if(!['sms','whatsapp','email','rcs','push'].includes(channel))throw new Error('Unknown channel');
  return new SandboxChannelAdapter(channel,config);
}
