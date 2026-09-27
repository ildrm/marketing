import { randomBytes } from 'node:crypto';

export const id = (prefix) => `${prefix}_${randomBytes(12).toString('hex')}`;
export const now = () => new Date().toISOString();
export const money = (value) => Number.isSafeInteger(value) && value >= 0;
export const ROLE = Object.freeze({ advertiser: ['campaign:write', 'booking:write', 'report:read', 'finance:read'], owner: ['property:write', 'proof:write', 'report:read', 'finance:read'], operator: ['review:write', 'report:read', 'finance:read'] });
export function allowed(role, capability) { return ROLE[role]?.includes(capability) ?? false; }
export function validateDestination(input, allowedHosts) {
  let url;
  try { url = new URL(input); } catch { throw new Error('Invalid destination URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || !allowedHosts.includes(url.hostname.toLowerCase())) throw new Error('Destination must use HTTPS and an approved host');
  return url.toString();
}
export function transition(current, next, map) {
  if (!map[current]?.includes(next)) throw new Error(`Cannot change ${current} to ${next}`);
  return next;
}
export const campaignTransitions = { draft: ['submitted', 'cancelled'], submitted: ['approved', 'draft', 'cancelled'], approved: ['booked', 'cancelled'], booked: ['live', 'cancelled'], live: ['paused', 'completed', 'disputed'], paused: ['live', 'cancelled'], completed: ['disputed', 'settled'], disputed: ['completed', 'cancelled'], settled: [], cancelled: [] };
export const bookingTransitions = { reserved: ['accepted', 'cancelled'], accepted: ['published', 'cancelled'], published: ['disputed', 'settled'], disputed: ['published', 'cancelled'], settled: [], cancelled: [] };
export function amounts(price) { if (!money(price) || price === 0) throw new Error('Price must be a positive integer in minor units'); const fee = Math.floor(price * 15 / 100); return { price, fee, payable: price - fee }; }
export function provenance(kind) { return ['platform_observed', 'provider_reported', 'owner_reported', 'imported', 'modeled'].includes(kind); }
