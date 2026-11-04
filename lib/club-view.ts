import type { Club, Member } from './chess';

// Apply before serializing either a read or a successful mutation response.
export function clubForMember(club:Club,member:Member|undefined):Club{
  if(!member||!club.members.some(m=>m.id===member.id&&m.role===member.role))throw new Error('Manager access required.');
  const admin=member?.role==='owner';
  return {...club,members:admin?club.members:[],audit:admin?club.audit:[]};
}
