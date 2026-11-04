export async function changePasswordIfCurrent(db:D1Database,accountId:string,currentHash:string,newHash:string):Promise<boolean>{
  const changed=await db.batch([
    db.prepare('UPDATE auth_accounts SET password_hash = ? WHERE id = ? AND password_hash = ? AND active = 1').bind(newHash,accountId,currentHash),
    db.prepare('DELETE FROM auth_sessions WHERE account_id = ? AND changes() = 1').bind(accountId),
  ]);
  return !!changed[0].meta.changes;
}
