/**
 * BM4 Secure Apps Script API
 * Google Sheet Secure Mode: server-side login, session token, role permission,
 * LockService writes, audit log, backup helper.
 *
 * Deploy:
 * 1) Paste ke Apps Script yang terhubung dengan Google Sheet BM4.
 * 2) Run setupBM4Security() sekali dari editor Apps Script.
 * 3) Lihat temporary admin password di Logs.
 * 4) Deploy Web App: Execute as Me, Who has access: Anyone.
 */

const BM4_CONFIG = {
  SESSION_HOURS: 12,
  IDLE_HOURS: 2,
  MAX_LOGIN_FAILS: 5,
  LOCK_MINUTES: 15,
  HASH_ITERATIONS: 4000,
  SHEETS: {
    USERS: 'Users',
    SESSIONS: 'Sessions',
    AUDIT: 'AuditLogs',
    DELETED: 'DeletedRecords',
    SETTINGS: 'Settings',
    PERUMAHAN: 'Perumahan',
    POI: 'POI',
    TARGET_PASAR: 'TargetPasar',
    PROYEK: 'Proyek',
    ACCOUNTS: 'Accounts',
    BACKUPS: 'Backups'
  }
};

const HEADERS = {
  Users: ['id','username','passwordHash','salt','nama','jabatan','role','akses','active','failedLoginCount','lockedUntil','lastLogin','createdAt','updatedAt','foto','bio'],
  Sessions: ['sessionId','userId','username','tokenHash','createdAt','expiresAt','lastSeen','deviceInfo','active'],
  AuditLogs: ['timestamp','userId','username','role','action','module','projectId','recordId','beforeJson','afterJson','deviceInfo','status','message'],
  DeletedRecords: ['timestamp','userId','username','module','recordId','beforeJson'],
  Settings: ['key','value','updatedAt','updatedBy'],
  Perumahan: ['id','nama','area','tipe','lat','lng','developer','unit','realisasi','tahun'],
  POI: ['nama','lat','lng','kat','label','emoji'],
  TargetPasar: ['id','nama','kategori','lat','lng','catatan','status','createdAt','updatedAt'],
  Proyek: ['id','nama','kode','area','tipe','unit','lat','lng','developer','ikon','warna','status','deskripsi','foto'],
  Accounts: ['username','password','nama','jabatan','role','foto','bio','akses','suspended'],
  Backups: ['timestamp','fileId','name','username','createdBy']
};

const READ_ACTIONS = ['ping','auth_verify','getPerumahan','getPoi','getTargetPasar','getProyek','getAccounts'];
const WRITE_ACTIONS = ['savePerumahan','savePoi','deletePerumahan','deletePoi','saveTargetPasar','deleteTargetPasar','saveProyek','saveAccounts','deleteAccount','logActivity'];

const ROLE_RULES = {
  bm: '*',
  owner: '*',
  admin: '*',
  manager: ['getPerumahan','getPoi','getTargetPasar','getProyek','savePerumahan','savePoi','saveTargetPasar','saveProyek','logActivity'],
  strategi: ['getPerumahan','getPoi','getTargetPasar','getProyek','saveTargetPasar','deleteTargetPasar','logActivity'],
  sales: ['getPerumahan','getPoi','getTargetPasar','getProyek','logActivity'],
  konstruksi: ['getPerumahan','getPoi','getProyek','logActivity'],
  viewer: ['getPerumahan','getPoi','getTargetPasar','getProyek','logActivity']
};

function doGet(e){
  return safeHandle_(e, 'GET');
}

function doPost(e){
  return safeHandle_(e, 'POST');
}

function safeHandle_(e, method){
  try {
    ensureSecuritySheets_();
    const req = parseRequest_(e);
    const result = route_(req, method);
    return json_(result);
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return json_({ success:false, error:String(err && err.message ? err.message : err) });
  }
}

function parseRequest_(e){
  const out = Object.assign({}, (e && e.parameter) || {});
  const raw = e && e.postData && e.postData.contents;
  if(raw){
    try { Object.assign(out, JSON.parse(raw)); }
    catch(_){ out.rawBody = raw; }
  }
  return out;
}

function route_(req, method){
  const action = String(req.action || '').trim();
  if(!action) return { success:false, error:'missing_action' };

  if(action === 'ping') return { success:true, app:'BM4 Secure API', time: nowIso_() };
  if(action === 'auth_login') return authLogin_(req);

  const ctx = requireSession_(req, action);
  if(action === 'auth_verify') return { success:true, user: publicUser_(ctx.user), expiresAt: ctx.session.expiresAt };
  if(action === 'auth_logout') return authLogout_(req, ctx);
  if(action === 'auth_change_password') return withWriteLock_(() => authChangePassword_(ctx, req));
  if(action === 'auth_update_profile') return withWriteLock_(() => authUpdateProfile_(ctx, req.profile || {}));

  requirePermission_(ctx, action);

  switch(action){
    case 'getPerumahan': return { success:true, data: readRows_(BM4_CONFIG.SHEETS.PERUMAHAN) };
    case 'getPoi': return { success:true, data: readRows_(BM4_CONFIG.SHEETS.POI) };
    case 'getTargetPasar': return { success:true, data: readRows_(BM4_CONFIG.SHEETS.TARGET_PASAR) };
    case 'getProyek': return { success:true, data: readRows_(BM4_CONFIG.SHEETS.PROYEK) };
    case 'getAccounts': return getAccounts_(ctx);

    case 'savePerumahan': return withWriteLock_(() => saveRowsAction_(ctx, BM4_CONFIG.SHEETS.PERUMAHAN, req.rows || req.data || [], action));
    case 'savePoi': return withWriteLock_(() => saveRowsAction_(ctx, BM4_CONFIG.SHEETS.POI, req.rows || req.data || [], action));
    case 'saveTargetPasar': return withWriteLock_(() => saveRowsAction_(ctx, BM4_CONFIG.SHEETS.TARGET_PASAR, req.rows || req.data || [], action));
    case 'saveProyek': return withWriteLock_(() => saveRowsAction_(ctx, BM4_CONFIG.SHEETS.PROYEK, req.data || req.rows || [], action));

    case 'deletePerumahan': return withWriteLock_(() => deleteRowAction_(ctx, BM4_CONFIG.SHEETS.PERUMAHAN, 'id', req.id, action));
    case 'deletePoi': return withWriteLock_(() => deleteRowAction_(ctx, BM4_CONFIG.SHEETS.POI, 'nama', req.nama, action));
    case 'deleteTargetPasar': return withWriteLock_(() => deleteRowAction_(ctx, BM4_CONFIG.SHEETS.TARGET_PASAR, 'id', req.id, action));

    case 'saveAccounts': return withWriteLock_(() => saveAccounts_(ctx, req.data || []));
    case 'deleteAccount': return withWriteLock_(() => deleteAccount_(ctx, req.username));
    case 'admin_users_list': return adminUsersList_(ctx);
    case 'admin_user_save': return withWriteLock_(() => adminUserSave_(ctx, req.user || {}));
    case 'admin_user_reset_password': return withWriteLock_(() => adminUserResetPassword_(ctx, req.username));
    case 'admin_user_set_active': return withWriteLock_(() => adminUserSetActive_(ctx, req.username, req.active));
    case 'admin_user_force_logout': return withWriteLock_(() => adminUserForceLogout_(ctx, req.username));
    case 'admin_sessions_list': return adminSessionsList_(ctx);
    case 'admin_session_revoke': return withWriteLock_(() => adminSessionRevoke_(ctx, req.sessionId));
    case 'admin_audit_list': return adminAuditList_(ctx, req);
    case 'admin_backup_now': return withWriteLock_(() => backupNow_(ctx));
    case 'admin_backup_status': return adminBackupStatus_(ctx, req);
    case 'logActivity': return logActivityCompat_(ctx, req.data || req);
    case 'backup_now': return withWriteLock_(() => backupNow_(ctx));
    default: return { success:false, error:'unknown_action', action:action };
  }
}

/** Run once from Apps Script editor. */
function setupBM4Security(){
  ensureSecuritySheets_();
  const users = readRows_(BM4_CONFIG.SHEETS.USERS);
  if(users.length){
    Logger.log('BM4 Security already has users. No admin created.');
    return;
  }
  const tempPass = Utilities.getUuid().replace(/-/g,'').slice(0,12) + '!';
  createUser_({
    username:'bm4',
    password:tempPass,
    nama:'Branch Manager Area 4',
    jabatan:'Branch Manager',
    role:'bm',
    akses:['dashboard','analisa','strategi','sales','konstruksi','legal','finance','galeri','tim','proyek'],
    active:true
  });
  setSetting_('security_setup_at', nowIso_(), 'system');
  Logger.log('Admin awal dibuat. Username: bm4');
  Logger.log('Password sementara: ' + tempPass);
  Logger.log('Segera login lalu ganti password / buat user baru.');
}

/** Optional: install daily backup trigger. */
function installDailyBackupTrigger(){
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'scheduledBackupBM4').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('scheduledBackupBM4').timeBased().everyDays(1).atHour(23).create();
  Logger.log('Daily backup trigger installed at around 23:00.');
}

function scheduledBackupBM4(){
  const fakeCtx = { user:{ id:'system', username:'system', role:'system' } };
  backupNow_(fakeCtx);
}

function authLogin_(req){
  const username = String(req.username || '').trim().toLowerCase();
  const password = String(req.password || '');
  const deviceInfo = String(req.deviceInfo || '').slice(0, 500);
  if(!username || !password) return { success:false, error:'missing_credentials', message:'Username dan password wajib diisi.' };

  return withWriteLock_(() => {
    const userTable = getTable_(BM4_CONFIG.SHEETS.USERS);
    const idx = userTable.rows.findIndex(r => String(r.username || '').toLowerCase() === username);
    if(idx < 0) {
      writeAudit_({ action:'auth_login_failed', module:'auth', username, status:'failed', message:'unknown_user', deviceInfo });
      Utilities.sleep(350);
      return { success:false, error:'invalid_login', message:'Username atau password salah.' };
    }
    const user = userTable.rows[idx];
    if(String(user.active).toLowerCase() === 'false' || String(user.active) === '0'){
      return { success:false, error:'account_inactive', message:'Akun dinonaktifkan. Hubungi BM.' };
    }
    const lockedUntil = user.lockedUntil ? new Date(user.lockedUntil).getTime() : 0;
    if(lockedUntil && lockedUntil > Date.now()){
      return { success:false, error:'account_locked', message:'Akun terkunci sementara karena terlalu banyak gagal login.' };
    }

    const ok = verifyPasswordServer_(password, user.passwordHash, user.salt);
    if(!ok){
      const fails = (Number(user.failedLoginCount) || 0) + 1;
      user.failedLoginCount = fails;
      if(fails >= BM4_CONFIG.MAX_LOGIN_FAILS){
        user.lockedUntil = new Date(Date.now() + BM4_CONFIG.LOCK_MINUTES * 60000).toISOString();
      }
      user.updatedAt = nowIso_();
      writeRows_(BM4_CONFIG.SHEETS.USERS, userTable.rows, HEADERS.Users);
      writeAudit_({ action:'auth_login_failed', module:'auth', userId:user.id, username:user.username, role:user.role, status:'failed', message:'bad_password', deviceInfo });
      return { success:false, error:'invalid_login', message:'Username atau password salah.' };
    }

    user.failedLoginCount = 0;
    user.lockedUntil = '';
    user.lastLogin = nowIso_();
    user.updatedAt = nowIso_();
    writeRows_(BM4_CONFIG.SHEETS.USERS, userTable.rows, HEADERS.Users);

    const token = Utilities.getUuid() + '.' + Utilities.getUuid();
    const session = {
      sessionId: Utilities.getUuid(),
      userId: user.id,
      username: user.username,
      tokenHash: hashToken_(token),
      createdAt: nowIso_(),
      expiresAt: new Date(Date.now() + BM4_CONFIG.SESSION_HOURS * 3600000).toISOString(),
      lastSeen: nowIso_(),
      deviceInfo: deviceInfo,
      active: true
    };
    const sessions = readRows_(BM4_CONFIG.SHEETS.SESSIONS).filter(s => !(s.username === user.username && String(s.active).toLowerCase() === 'true'));
    sessions.push(session);
    writeRows_(BM4_CONFIG.SHEETS.SESSIONS, sessions, HEADERS.Sessions);

    writeAudit_({ action:'auth_login', module:'auth', userId:user.id, username:user.username, role:user.role, status:'success', deviceInfo });
    return { success:true, sessionToken: token, expiresAt: session.expiresAt, user: publicUser_(user) };
  });
}

function authLogout_(req, ctx){
  const tokenHash = hashToken_(String(req.sessionToken || ''));
  const rows = readRows_(BM4_CONFIG.SHEETS.SESSIONS);
  rows.forEach(r => { if(r.tokenHash === tokenHash) r.active = false; });
  writeRows_(BM4_CONFIG.SHEETS.SESSIONS, rows, HEADERS.Sessions);
  writeAudit_({ action:'auth_logout', module:'auth', userId:ctx.user.id, username:ctx.user.username, role:ctx.user.role, status:'success', deviceInfo:String(req.deviceInfo||'') });
  return { success:true };
}

function authChangePassword_(ctx, req){
  const oldPassword = String(req.oldPassword || '');
  const newPassword = String(req.newPassword || '');
  const deviceInfo = String(req.deviceInfo || '').slice(0, 500);

  if(!oldPassword || !newPassword){
    return { success:false, error:'missing_password', message:'Password lama dan password baru wajib diisi.' };
  }
  if(newPassword.length < 8){
    return { success:false, error:'weak_password', message:'Password baru minimal 8 karakter.' };
  }
  if(oldPassword === newPassword){
    return { success:false, error:'same_password', message:'Password baru tidak boleh sama dengan password lama.' };
  }

  const rows = readRows_(BM4_CONFIG.SHEETS.USERS);
  const idx = rows.findIndex(u => String(u.id) === String(ctx.user.id) || String(u.username).toLowerCase() === String(ctx.user.username).toLowerCase());
  if(idx < 0) throw new Error('User tidak ditemukan');

  const u = rows[idx];
  const ok = verifyPasswordServer_(oldPassword, u.passwordHash, u.salt);
  if(!ok){
    writeAudit_({
      action:'auth_change_password_failed',
      module:'auth',
      userId:ctx.user.id,
      username:ctx.user.username,
      role:ctx.user.role,
      status:'failed',
      message:'old_password_wrong',
      deviceInfo
    });
    return { success:false, error:'invalid_old_password', message:'Password lama salah.' };
  }

  u.salt = Utilities.getUuid();
  u.passwordHash = hashPasswordServer_(newPassword, u.salt);
  u.failedLoginCount = 0;
  u.lockedUntil = '';
  u.updatedAt = nowIso_();
  rows[idx] = u;
  writeRows_(BM4_CONFIG.SHEETS.USERS, rows, HEADERS.Users);

  // Amankan akun: session lain milik user ini dicabut, session saat ini tetap aktif.
  const sessions = readRows_(BM4_CONFIG.SHEETS.SESSIONS);
  sessions.forEach(s => {
    const sameUser = String(s.username).toLowerCase() === String(ctx.user.username).toLowerCase();
    const currentSession = String(s.sessionId) === String(ctx.session.sessionId);
    if(sameUser && !currentSession) s.active = false;
  });
  writeRows_(BM4_CONFIG.SHEETS.SESSIONS, sessions, HEADERS.Sessions);

  writeAudit_({
    action:'auth_change_password',
    module:'auth',
    userId:ctx.user.id,
    username:ctx.user.username,
    role:ctx.user.role,
    status:'success',
    message:'password_changed_self',
    deviceInfo
  });

  return { success:true, message:'Password berhasil diubah.' };
}

function authUpdateProfile_(ctx, profile){
  const rows = readRows_(BM4_CONFIG.SHEETS.USERS);
  const idx = rows.findIndex(u => String(u.username).toLowerCase() === String(ctx.user.username).toLowerCase());
  if(idx < 0) throw new Error('User tidak ditemukan');
  const u = rows[idx];
  const before = Object.assign({}, u);
  if(profile.bio !== undefined) u.bio = String(profile.bio || '').slice(0, 150);
  if(profile.foto !== undefined) {
    const foto = String(profile.foto || '');
    if(foto && !(foto.indexOf('data:image/') === 0 || foto.indexOf('http://') === 0 || foto.indexOf('https://') === 0)) throw new Error('Format foto tidak valid');
    u.foto = foto;
  }
  u.updatedAt = nowIso_();
  writeRows_(BM4_CONFIG.SHEETS.USERS, rows, HEADERS.Users);
  writeAudit_({ action:'auth_update_profile', module:'users', userId:ctx.user.id, username:ctx.user.username, role:ctx.user.role, recordId:ctx.user.username, beforeJson:JSON.stringify({bio:before.bio||'', foto:before.foto?'set':''}), afterJson:JSON.stringify({bio:u.bio||'', foto:u.foto?'set':''}), status:'success' });
  return { success:true, user: publicUser_(u) };
}

function requireSession_(req, action){
  const token = String(req.sessionToken || '').trim();
  if(!token) throw new Error('unauthorized: session token kosong');
  const tokenHash = hashToken_(token);
  const sessions = readRows_(BM4_CONFIG.SHEETS.SESSIONS);
  const sIdx = sessions.findIndex(s => s.tokenHash === tokenHash && String(s.active).toLowerCase() !== 'false');
  if(sIdx < 0) throw new Error('unauthorized: session tidak ditemukan');
  const session = sessions[sIdx];
  const now = Date.now();
  const exp = new Date(session.expiresAt).getTime();
  const last = new Date(session.lastSeen || session.createdAt).getTime();
  if(exp < now || (last && now - last > BM4_CONFIG.IDLE_HOURS * 3600000)){
    session.active = false;
    writeRows_(BM4_CONFIG.SHEETS.SESSIONS, sessions, HEADERS.Sessions);
    throw new Error('unauthorized: session expired');
  }
  session.lastSeen = nowIso_();
  sessions[sIdx] = session;
  writeRows_(BM4_CONFIG.SHEETS.SESSIONS, sessions, HEADERS.Sessions);

  const user = readRows_(BM4_CONFIG.SHEETS.USERS).find(u => u.id === session.userId || String(u.username).toLowerCase() === String(session.username).toLowerCase());
  if(!user) throw new Error('unauthorized: user tidak ditemukan');
  if(String(user.active).toLowerCase() === 'false' || String(user.active) === '0') throw new Error('forbidden: akun nonaktif');
  return { session, user };
}

function requirePermission_(ctx, action){
  const role = String(ctx.user.role || '').toLowerCase();
  const rule = ROLE_RULES[role] || [];
  if(rule === '*') return true;
  if(rule.indexOf(action) >= 0) return true;
  throw new Error('permission_denied: role ' + role + ' tidak boleh menjalankan ' + action);
}

function getAccounts_(ctx){
  requirePermission_(ctx, 'getAccounts');
  if(!['bm','owner','admin'].includes(String(ctx.user.role).toLowerCase())) throw new Error('permission_denied');
  const users = readRows_(BM4_CONFIG.SHEETS.USERS).map(publicUser_);
  return { success:true, data: users };
}

function saveAccounts_(ctx, rows){
  if(!Array.isArray(rows)) throw new Error('saveAccounts expects array');
  const before = readRows_(BM4_CONFIG.SHEETS.USERS);
  rows.forEach(a => {
    if(!a.username) return;
    const existing = before.find(u => String(u.username).toLowerCase() === String(a.username).toLowerCase());
    if(existing){
      existing.nama = a.nama || existing.nama || '';
      existing.jabatan = a.jabatan || existing.jabatan || '';
      if(a.foto !== undefined) existing.foto = a.foto || '';
      if(a.bio !== undefined) existing.bio = String(a.bio || '').slice(0,150);
      existing.role = a.role || existing.role || 'viewer';
      existing.akses = Array.isArray(a.akses) ? a.akses.join(',') : (a.akses || existing.akses || 'dashboard');
      existing.active = a.suspended ? false : (a.active !== false);
      if(a.password && !String(a.password).startsWith('s1$')){
        existing.salt = Utilities.getUuid();
        existing.passwordHash = hashPasswordServer_(String(a.password), existing.salt);
      }
      existing.updatedAt = nowIso_();
    } else {
      createUser_({
        username:a.username,
        password:a.password || Utilities.getUuid().slice(0,10) + '!',
        nama:a.nama || '', jabatan:a.jabatan || '', foto:a.foto || '', bio:a.bio || '', role:a.role || 'viewer', akses:a.akses || ['dashboard'], active:!a.suspended
      }, before);
    }
  });
  writeRows_(BM4_CONFIG.SHEETS.USERS, before, HEADERS.Users);
  writeAudit_({ action:'saveAccounts', module:'users', userId:ctx.user.id, username:ctx.user.username, role:ctx.user.role, beforeJson:'', afterJson:JSON.stringify(rows), status:'success' });
  return { success:true, count:rows.length };
}

function deleteAccount_(ctx, username){
  const rows = readRows_(BM4_CONFIG.SHEETS.USERS);
  const u = rows.find(r => String(r.username).toLowerCase() === String(username).toLowerCase());
  if(!u) return { success:false, error:'not_found' };
  u.active = false;
  u.updatedAt = nowIso_();
  writeRows_(BM4_CONFIG.SHEETS.USERS, rows, HEADERS.Users);
  writeAudit_({ action:'deleteAccount', module:'users', userId:ctx.user.id, username:ctx.user.username, role:ctx.user.role, recordId:username, beforeJson:JSON.stringify(u), status:'success' });
  return { success:true };
}


function requireAdmin_(ctx){
  const role = String(ctx.user && ctx.user.role || '').toLowerCase();
  if(['bm','owner','admin'].indexOf(role) < 0) throw new Error('permission_denied: Security Center hanya untuk BM/Admin');
}

function adminUsersList_(ctx){
  requireAdmin_(ctx);
  return { success:true, data: readRows_(BM4_CONFIG.SHEETS.USERS).map(publicUser_) };
}

function adminUserSave_(ctx, input){
  requireAdmin_(ctx);
  const username = String(input.username || '').trim().toLowerCase();
  if(!username) throw new Error('Username wajib diisi');
  const rows = readRows_(BM4_CONFIG.SHEETS.USERS);
  const idx = rows.findIndex(u => String(u.username).toLowerCase() === username);
  const before = idx >= 0 ? Object.assign({}, rows[idx]) : null;
  const akses = Array.isArray(input.akses) ? input.akses.join(',') : String(input.akses || 'dashboard,galeri');
  if(idx >= 0){
    const u = rows[idx];
    u.nama = input.nama || u.nama || '';
    u.jabatan = input.jabatan || u.jabatan || '';
    if(input.foto !== undefined){
      const foto = String(input.foto || '');
      if(foto && !(foto.indexOf('data:image/') === 0 || foto.indexOf('http://') === 0 || foto.indexOf('https://') === 0)) throw new Error('Format foto tidak valid');
      u.foto = foto;
    }
    if(input.bio !== undefined) u.bio = String(input.bio || '').slice(0,150);
    u.role = input.role || u.role || 'viewer';
    u.akses = akses;
    u.active = input.active !== false;
    if(input.password){
      u.salt = Utilities.getUuid();
      u.passwordHash = hashPasswordServer_(String(input.password), u.salt);
      u.failedLoginCount = 0;
      u.lockedUntil = '';
    }
    u.updatedAt = nowIso_();
  } else {
    const pass = input.password || Utilities.getUuid().replace(/-/g,'').slice(0,10) + '!';
    createUser_({ username:username, password:pass, nama:input.nama||'', jabatan:input.jabatan||'', foto:input.foto||'', bio:input.bio||'', role:input.role||'viewer', akses:akses, active:input.active !== false }, rows);
  }
  writeRows_(BM4_CONFIG.SHEETS.USERS, rows, HEADERS.Users);
  writeAudit_({ action:'admin_user_save', module:'users', userId:ctx.user.id, username:ctx.user.username, role:ctx.user.role, recordId:username, beforeJson:JSON.stringify(before || {}), afterJson:JSON.stringify({ username:username, role:input.role, akses:akses, active:input.active !== false }), status:'success' });
  return { success:true };
}

function adminUserResetPassword_(ctx, username){
  requireAdmin_(ctx);
  username = String(username || '').trim().toLowerCase();
  if(!username) throw new Error('Username kosong');
  const rows = readRows_(BM4_CONFIG.SHEETS.USERS);
  const u = rows.find(r => String(r.username).toLowerCase() === username);
  if(!u) throw new Error('User tidak ditemukan');
  const tempPass = Utilities.getUuid().replace(/-/g,'').slice(0,12) + '!';
  u.salt = Utilities.getUuid();
  u.passwordHash = hashPasswordServer_(tempPass, u.salt);
  u.failedLoginCount = 0;
  u.lockedUntil = '';
  u.updatedAt = nowIso_();
  writeRows_(BM4_CONFIG.SHEETS.USERS, rows, HEADERS.Users);
  writeAudit_({ action:'admin_user_reset_password', module:'users', userId:ctx.user.id, username:ctx.user.username, role:ctx.user.role, recordId:username, status:'success' });
  return { success:true, tempPassword:tempPass };
}

function adminUserSetActive_(ctx, username, active){
  requireAdmin_(ctx);
  username = String(username || '').trim().toLowerCase();
  const rows = readRows_(BM4_CONFIG.SHEETS.USERS);
  const u = rows.find(r => String(r.username).toLowerCase() === username);
  if(!u) throw new Error('User tidak ditemukan');
  u.active = !!active;
  u.updatedAt = nowIso_();
  if(!active){
    const sessions = readRows_(BM4_CONFIG.SHEETS.SESSIONS);
    sessions.forEach(s => { if(String(s.username).toLowerCase() === username) s.active = false; });
    writeRows_(BM4_CONFIG.SHEETS.SESSIONS, sessions, HEADERS.Sessions);
  }
  writeRows_(BM4_CONFIG.SHEETS.USERS, rows, HEADERS.Users);
  writeAudit_({ action:'admin_user_set_active', module:'users', userId:ctx.user.id, username:ctx.user.username, role:ctx.user.role, recordId:username, afterJson:JSON.stringify({active:!!active}), status:'success' });
  return { success:true };
}

function adminUserForceLogout_(ctx, username){
  requireAdmin_(ctx);
  username = String(username || '').trim().toLowerCase();
  if(!username) throw new Error('Username kosong');
  if(String(ctx.user.username || '').toLowerCase() === username) throw new Error('Tidak bisa force logout diri sendiri. Gunakan tombol Keluar.');
  const sessions = readRows_(BM4_CONFIG.SHEETS.SESSIONS);
  let count = 0;
  sessions.forEach(s => {
    if(String(s.username || '').toLowerCase() === username && String(s.active).toLowerCase() !== 'false'){
      s.active = false;
      count++;
    }
  });
  writeRows_(BM4_CONFIG.SHEETS.SESSIONS, sessions, HEADERS.Sessions);
  writeAudit_({ action:'admin_user_force_logout', module:'sessions', userId:ctx.user.id, username:ctx.user.username, role:ctx.user.role, recordId:username, afterJson:JSON.stringify({revoked:count}), status:'success' });
  return { success:true, revoked:count };
}

function adminSessionsList_(ctx){
  requireAdmin_(ctx);
  const rows = readRows_(BM4_CONFIG.SHEETS.SESSIONS)
    .filter(s => String(s.active).toLowerCase() !== 'false')
    .map(s => ({ sessionId:s.sessionId, userId:s.userId, username:s.username, createdAt:s.createdAt, expiresAt:s.expiresAt, lastSeen:s.lastSeen, deviceInfo:s.deviceInfo, active:String(s.active).toLowerCase() !== 'false' }));
  rows.sort((a,b) => new Date(b.lastSeen || b.createdAt).getTime() - new Date(a.lastSeen || a.createdAt).getTime());
  return { success:true, data:rows };
}

function adminSessionRevoke_(ctx, sessionId){
  requireAdmin_(ctx);
  const rows = readRows_(BM4_CONFIG.SHEETS.SESSIONS);
  let found = false;
  rows.forEach(s => { if(String(s.sessionId) === String(sessionId)){ s.active = false; found = true; } });
  writeRows_(BM4_CONFIG.SHEETS.SESSIONS, rows, HEADERS.Sessions);
  writeAudit_({ action:'admin_session_revoke', module:'sessions', userId:ctx.user.id, username:ctx.user.username, role:ctx.user.role, recordId:sessionId, status:found?'success':'failed', message:found?'':'session_not_found' });
  return { success:found, error:found?'':'not_found' };
}

function adminAuditList_(ctx, req){
  requireAdmin_(ctx);
  const limit = Math.min(500, Math.max(10, Number(req.limit || 120)));
  let rows = readRows_(BM4_CONFIG.SHEETS.AUDIT);
  rows.sort((a,b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return { success:true, data:rows.slice(0, limit) };
}

function adminBackupStatus_(ctx, req){
  requireAdmin_(ctx);
  const limit = Math.min(50, Math.max(5, Number(req.limit || 20)));
  let rows = readRows_(BM4_CONFIG.SHEETS.BACKUPS);
  rows.sort((a,b) => new Date(b.timestamp || b.createdAt).getTime() - new Date(a.timestamp || a.createdAt).getTime());
  return { success:true, data:rows.slice(0, limit) };
}

function logActivityCompat_(ctx, data){
  writeAudit_({ action:data.action || 'client_log', module:'client', userId:ctx.user.id, username:ctx.user.username, role:ctx.user.role, afterJson:JSON.stringify(data), status:'success', message:data.detail || '' });
  return { success:true };
}

function saveRowsAction_(ctx, sheetName, rows, action){
  if(!Array.isArray(rows)) throw new Error(action + ' expects rows array');
  const headers = inferHeaders_(sheetName, rows);
  const before = readRows_(sheetName);
  writeRows_(sheetName, rows, headers);
  writeAudit_({ action, module:sheetName, userId:ctx.user.id, username:ctx.user.username, role:ctx.user.role, beforeJson:JSON.stringify({count:before.length}), afterJson:JSON.stringify({count:rows.length}), status:'success' });
  return { success:true, count:rows.length };
}

function deleteRowAction_(ctx, sheetName, key, value, action){
  const rows = readRows_(sheetName);
  const idx = rows.findIndex(r => String(r[key]) === String(value));
  if(idx < 0) return { success:false, error:'not_found' };
  const before = rows[idx];
  rows.splice(idx, 1);
  writeRows_(sheetName, rows, inferHeaders_(sheetName, rows));
  writeRowsAppend_(BM4_CONFIG.SHEETS.DELETED, [{ timestamp:nowIso_(), userId:ctx.user.id, username:ctx.user.username, module:sheetName, recordId:value, beforeJson:JSON.stringify(before) }], HEADERS.DeletedRecords);
  writeAudit_({ action, module:sheetName, userId:ctx.user.id, username:ctx.user.username, role:ctx.user.role, recordId:value, beforeJson:JSON.stringify(before), status:'success' });
  return { success:true };
}

function backupNow_(ctx){
  const ss = getSpreadsheet_();
  const name = 'BM4 Backup ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HHmmss');
  const file = DriveApp.getFileById(ss.getId()).makeCopy(name);
  const row = { timestamp:nowIso_(), fileId:file.getId(), name:name, username:(ctx.user && ctx.user.username) || 'system', createdBy:(ctx.user && ctx.user.id) || 'system' };
  writeRowsAppend_(BM4_CONFIG.SHEETS.BACKUPS, [row], HEADERS.Backups);
  writeAudit_({ action:'backup_now', module:'backup', userId:ctx.user.id, username:ctx.user.username, role:ctx.user.role, afterJson:JSON.stringify({ fileId:file.getId(), name:name }), status:'success' });
  return { success:true, fileId:file.getId(), name:name };
}

function createUser_(input, existingRows){
  const rows = existingRows || readRows_(BM4_CONFIG.SHEETS.USERS);
  const salt = Utilities.getUuid();
  const user = {
    id: Utilities.getUuid(),
    username: String(input.username || '').trim().toLowerCase(),
    passwordHash: hashPasswordServer_(String(input.password || ''), salt),
    salt: salt,
    nama: input.nama || '',
    jabatan: input.jabatan || '',
    foto: input.foto || '',
    bio: input.bio || '',
    role: input.role || 'viewer',
    akses: Array.isArray(input.akses) ? input.akses.join(',') : (input.akses || 'dashboard'),
    active: input.active !== false,
    failedLoginCount: 0,
    lockedUntil: '',
    lastLogin: '',
    createdAt: nowIso_(),
    updatedAt: nowIso_()
  };
  rows.push(user);
  if(!existingRows) writeRows_(BM4_CONFIG.SHEETS.USERS, rows, HEADERS.Users);
  return user;
}

function publicUser_(u){
  return {
    id:u.id || '', username:u.username || '', nama:u.nama || '', jabatan:u.jabatan || '', role:u.role || 'viewer',
    akses: parseAccess_(u.akses), active: String(u.active).toLowerCase() !== 'false', foto:u.foto || '', bio:u.bio || ''
  };
}

function parseAccess_(v){
  if(Array.isArray(v)) return v;
  if(!v) return [];
  return String(v).split(',').map(s => s.trim()).filter(Boolean);
}

function hashPasswordServer_(password, salt){
  const secret = getSecret_('BM4_PASSWORD_PEPPER');
  let h = password + ':' + salt + ':' + secret;
  for(let i=0;i<BM4_CONFIG.HASH_ITERATIONS;i++){
    h = bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h, Utilities.Charset.UTF_8));
  }
  return 's1$' + BM4_CONFIG.HASH_ITERATIONS + '$' + h;
}

function verifyPasswordServer_(password, storedHash, salt){
  if(!storedHash || !salt) return false;
  if(String(storedHash).indexOf('s1$') !== 0) return false;
  return hashPasswordServer_(password, salt) === storedHash;
}

function hashToken_(token){
  return bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(token || '') + ':' + getSecret_('BM4_SESSION_SECRET'), Utilities.Charset.UTF_8));
}

function getSecret_(key){
  const props = PropertiesService.getScriptProperties();
  let v = props.getProperty(key);
  if(!v){
    v = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty(key, v);
  }
  return v;
}

function bytesToHex_(bytes){
  return bytes.map ? bytes.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2,'0')).join('') : Array.prototype.map.call(bytes, b => (b < 0 ? b + 256 : b).toString(16).padStart(2,'0')).join('');
}

function getSpreadsheet_(){
  const id = PropertiesService.getScriptProperties().getProperty('BM4_SPREADSHEET_ID');
  if(id) return SpreadsheetApp.openById(id);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if(!ss) throw new Error('Spreadsheet tidak ditemukan. Isi Script Property BM4_SPREADSHEET_ID.');
  return ss;
}

function ensureSecuritySheets_(){
  const ss = getSpreadsheet_();
  Object.keys(HEADERS).forEach(name => ensureSheet_(ss, name, HEADERS[name]));
}

function ensureSheet_(ss, name, headers){
  let sh = ss.getSheetByName(name);
  if(!sh) sh = ss.insertSheet(name);
  const first = sh.getRange(1,1,1,Math.max(headers.length, sh.getLastColumn() || 1)).getValues()[0];
  const empty = first.every(v => !v);
  if(empty){
    sh.getRange(1,1,1,headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function getTable_(sheetName){
  const ss = getSpreadsheet_();
  const sh = ensureSheet_(ss, sheetName, HEADERS[sheetName] || []);
  const values = sh.getDataRange().getValues();
  if(values.length < 1) return { headers:HEADERS[sheetName] || [], rows:[] };
  const headers = values[0].map(String);
  const rows = values.slice(1).filter(r => r.some(v => v !== '')).map(r => {
    const o = {};
    headers.forEach((h,i) => o[h] = r[i]);
    return o;
  });
  return { headers, rows };
}

function readRows_(sheetName){
  return getTable_(sheetName).rows;
}

function writeRows_(sheetName, rows, headers){
  const ss = getSpreadsheet_();
  const sh = ensureSheet_(ss, sheetName, headers || HEADERS[sheetName] || []);
  const h = headers && headers.length ? headers : inferHeaders_(sheetName, rows);
  sh.clearContents();
  sh.getRange(1,1,1,h.length).setValues([h]);
  if(rows && rows.length){
    const vals = rows.map(row => h.map(k => normalizeCell_(row[k])));
    sh.getRange(2,1,vals.length,h.length).setValues(vals);
  }
  sh.setFrozenRows(1);
  SpreadsheetApp.flush();
}

function writeRowsAppend_(sheetName, rows, headers){
  if(!rows || !rows.length) return;
  const ss = getSpreadsheet_();
  const sh = ensureSheet_(ss, sheetName, headers || HEADERS[sheetName] || []);
  const h = headers || getTable_(sheetName).headers;
  const vals = rows.map(row => h.map(k => normalizeCell_(row[k])));
  sh.getRange(sh.getLastRow()+1,1,vals.length,h.length).setValues(vals);
  SpreadsheetApp.flush();
}

function inferHeaders_(sheetName, rows){
  const base = HEADERS[sheetName] ? HEADERS[sheetName].slice() : [];
  (rows || []).forEach(r => Object.keys(r || {}).forEach(k => { if(base.indexOf(k) < 0) base.push(k); }));
  return base.length ? base : ['id','data'];
}

function normalizeCell_(v){
  if(v === null || v === undefined) return '';
  if(Array.isArray(v)) return v.join(',');
  if(typeof v === 'object') return JSON.stringify(v);
  return v;
}

function writeAudit_(a){
  writeRowsAppend_(BM4_CONFIG.SHEETS.AUDIT, [{
    timestamp: nowIso_(), userId:a.userId||'', username:a.username||'', role:a.role||'', action:a.action||'', module:a.module||'', projectId:a.projectId||'', recordId:a.recordId||'',
    beforeJson:a.beforeJson||'', afterJson:a.afterJson||'', deviceInfo:a.deviceInfo||'', status:a.status||'', message:a.message||''
  }], HEADERS.AuditLogs);
}

function setSetting_(key, value, by){
  const rows = readRows_(BM4_CONFIG.SHEETS.SETTINGS);
  const idx = rows.findIndex(r => r.key === key);
  const row = { key, value, updatedAt:nowIso_(), updatedBy:by || '' };
  if(idx >= 0) rows[idx] = row; else rows.push(row);
  writeRows_(BM4_CONFIG.SHEETS.SETTINGS, rows, HEADERS.Settings);
}

function withWriteLock_(fn){
  const lock = LockService.getScriptLock();
  if(!lock.tryLock(30000)) throw new Error('server_busy: gagal mendapatkan lock');
  try { return fn(); }
  finally { lock.releaseLock(); }
}

function json_(obj){
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function nowIso_(){ return new Date().toISOString(); }

/**
 * MIGRASI AKUN LAMA → SECURE USERS
 *
 * Cara pakai:
 * 1. Buka Apps Script editor (tempat Code.gs ini berada)
 * 2. Pilih fungsi migrateOldAccountsToUsers di dropdown
 * 3. Klik Run
 * 4. Lihat tab "Logs" (View → Logs atau Execution log)
 * 5. Catat daftar password sementara dari log → bagikan ke tim secara aman
 *
 * Fungsi ini AMAN dijalankan beberapa kali:
 * - Akun yang sudah ada di Users (berdasarkan username) akan di-skip
 * - Hanya akun baru yang dibuatkan password sementara
 * - Tab Accounts lama TIDAK dihapus, tetap sebagai cadangan
 */
function migrateOldAccountsToUsers(){
  ensureSecuritySheets_();
  const oldAccounts = readRows_(BM4_CONFIG.SHEETS.ACCOUNTS);
  if(!oldAccounts.length){
    Logger.log('Tab "Accounts" kosong. Tidak ada yang dimigrasi.');
    return;
  }

  const existingUsers = readRows_(BM4_CONFIG.SHEETS.USERS);
  const existingUsernames = new Set(existingUsers.map(u => String(u.username || '').toLowerCase()));

  const created = [];
  const skipped = [];

  oldAccounts.forEach(a => {
    const username = String(a.username || '').trim().toLowerCase();
    if(!username) return;

    if(existingUsernames.has(username)){
      skipped.push(username);
      return;
    }

    // Generate password sementara: 4 huruf + 4 angka, hindari karakter membingungkan
    const tempPass = _bm4MigrationGenPass_();

    // Tentukan akses dari kolom akses lama (string atau array)
    let akses = a.akses;
    if(typeof akses === 'string'){
      akses = akses.split(',').map(s => s.trim()).filter(Boolean);
    }
    if(!Array.isArray(akses) || akses.length === 0){
      akses = ['dashboard'];
    }

    // Role dari Sheets lama, fallback ke 'viewer' kalau kosong
    const role = String(a.role || 'viewer').toLowerCase();

    // Active: kalau kolom 'suspended' true → akun nonaktif
    const active = !(a.suspended === true || String(a.suspended).toLowerCase() === 'true');

    createUser_({
      username: username,
      password: tempPass,
      nama: a.nama || '',
      jabatan: a.jabatan || '',
      foto: a.foto || '',
      bio: a.bio || '',
      role: role,
      akses: akses,
      active: active
    }, existingUsers);

    created.push({ username: username, role: role, password: tempPass });
    existingUsernames.add(username);
  });

  // Tulis sekaligus untuk efisiensi
  if(created.length){
    writeRows_(BM4_CONFIG.SHEETS.USERS, existingUsers, HEADERS.Users);
    setSetting_('migration_old_accounts_at', nowIso_(), 'system');
    writeAudit_({
      action: 'migrate_accounts',
      module: 'admin',
      userId: 'system',
      username: 'system',
      role: 'system',
      afterJson: JSON.stringify({ count: created.length, usernames: created.map(c => c.username) }),
      status: 'success'
    });
  }

  // Logs ringkas
  Logger.log('========================================');
  Logger.log('MIGRASI AKUN LAMA → USERS SELESAI');
  Logger.log('========================================');
  Logger.log('Berhasil dibuat: ' + created.length + ' akun');
  Logger.log('Di-skip (sudah ada di Users): ' + skipped.length + ' akun');
  if(skipped.length) Logger.log('Skipped: ' + skipped.join(', '));
  Logger.log('');
  Logger.log('PASSWORD SEMENTARA — bagikan ke tim secara AMAN:');
  Logger.log('(Setiap user wajib ganti sendiri setelah login pertama lewat Security Center → Reset Password)');
  Logger.log('----------------------------------------');
  created.forEach(c => {
    Logger.log('Username: ' + c.username + '  |  Role: ' + c.role + '  |  Password: ' + c.password);
  });
  Logger.log('----------------------------------------');
  Logger.log('PENTING: Setelah semua password dibagikan, hapus log ini dari riwayat eksekusi.');
}

function _bm4MigrationGenPass_(){
  const alpha = 'abcdefghjkmnpqrstuvwxyz';
  const num = '23456789';
  let pw = '';
  for(let i = 0; i < 4; i++) pw += alpha.charAt(Math.floor(Math.random() * alpha.length));
  for(let i = 0; i < 4; i++) pw += num.charAt(Math.floor(Math.random() * num.length));
  return pw;
}
