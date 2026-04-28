// ============================================================
// BM4 Patch Registry — v11 Release Candidate
// Fokus: aplikasi utama siap uji penuh. Secure Mode tetap OFF
// agar akun lama/localStorage tetap bisa dipakai saat UAT awal.
// ============================================================
window.BM4_PATCH_VERSION = 'v11-release-candidate';
window.BM4_PATCHES = [
  {
    id: 'patch-001-secure-session',
    name: 'Secure Session Adapter',
    version: '1.0.0',
    enabled: true,
    file: 'js/patches/patch-001-secure-session.js',
    css: null,
    dependsOn: []
  },
  {
    id: 'patch-002-security-center',
    name: 'Security Center + Audit + Backup',
    version: '1.0.0',
    enabled: true,
    file: 'js/patches/patch-002-security-center.js',
    css: 'css/patches/patch-002-security-center.css',
    dependsOn: ['patch-001-secure-session']
  },
  {
    id: 'patch-003-stability-guard',
    name: 'Stability Guard + Local Checkpoint',
    version: '1.1.0',
    enabled: true,
    file: 'js/patches/patch-003-stability-guard.js',
    css: 'css/patches/patch-003-stability-guard.css',
    dependsOn: []
  },
  {
    id: 'patch-004-editor-data-safety',
    name: 'Editor Data Safety + Validation',
    version: '1.1.0',
    enabled: true,
    file: 'js/patches/patch-004-editor-data-safety.js',
    css: 'css/patches/patch-004-editor-data-safety.css',
    dependsOn: ['patch-003-stability-guard']
  },
  {
    id: 'patch-005-sync-backup-improvement',
    name: 'Sync & Backup Improvement',
    version: '1.1.0',
    enabled: true,
    file: 'js/patches/patch-005-sync-backup-improvement.js',
    css: 'css/patches/patch-005-sync-backup-improvement.css',
    dependsOn: ['patch-003-stability-guard','patch-004-editor-data-safety']
  },
  {
    id: 'patch-006-test-center',
    name: 'Operational Test Center',
    version: '1.1.0',
    enabled: true,
    file: 'js/patches/patch-006-test-center.js',
    css: 'css/patches/patch-006-test-center.css',
    dependsOn: []
  },
  {
    id: 'patch-007-mobile-draft-importer',
    name: 'Mobile Draft Importer',
    version: '1.0.0',
    enabled: true,
    file: 'js/patches/patch-007-mobile-draft-importer.js',
    css: 'css/patches/patch-007-mobile-draft-importer.css',
    dependsOn: ['patch-003-stability-guard','patch-004-editor-data-safety']
  },
  {
    id: 'patch-008-release-readiness-center',
    name: 'Release Readiness Center',
    version: '1.0.0',
    enabled: true,
    file: 'js/patches/patch-008-release-readiness-center.js',
    css: 'css/patches/patch-008-release-readiness-center.css',
    dependsOn: ['patch-006-test-center']
  },
  {
    id: 'patch-009-rc-polish-guard',
    name: 'RC Polish Guard',
    version: '1.0.0',
    enabled: true,
    file: 'js/patches/patch-009-rc-polish-guard.js',
    css: 'css/patches/patch-009-rc-polish-guard.css',
    dependsOn: []
  }
];
