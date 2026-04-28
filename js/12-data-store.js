// ============================================================
// BM4 DATA STORE v9.6
// Satu pintu cache lokal agar localStorage tidak tersebar di banyak modul.
// ============================================================
(function(window){
  const KEYS = {
    coreData: 'bm4_data',
    targetPasar: 'bm4_tp_targets',
    accounts: 'bm4_accounts',
    accountLogs: 'bm4_account_logs',
    projects: 'bm4_proyek',
    formula: 'bm4_formula',
    appState: 'bm4_app_state'
  };

  function readJson(key, fallback){
    try {
      const raw = localStorage.getItem(key);
      if(!raw) return fallback;
      return JSON.parse(raw);
    } catch(e){
      console.warn('[BM4DataStore] readJson gagal:', key, e);
      return fallback;
    }
  }

  function writeJson(key, value){
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch(e){
      console.warn('[BM4DataStore] writeJson gagal:', key, e);
      return false;
    }
  }

  function remove(key){
    try { localStorage.removeItem(key); return true; }
    catch(e){ return false; }
  }

  const Store = {
    KEYS,
    readJson,
    writeJson,
    remove,

    loadCoreData(fallback){
      return readJson(KEYS.coreData, fallback || null);
    },
    saveCoreData(perumahan, poi){
      return writeJson(KEYS.coreData, { perumahan: perumahan || [], poi: poi || [] });
    },
    clearCoreData(){
      return remove(KEYS.coreData);
    },

    loadTargetPasar(fallback){
      return readJson(KEYS.targetPasar, fallback || null);
    },
    saveTargetPasar(rows){
      return writeJson(KEYS.targetPasar, rows || []);
    },

    loadAccounts(fallback){
      return readJson(KEYS.accounts, fallback || []);
    },
    saveAccounts(rows){
      return writeJson(KEYS.accounts, rows || []);
    },
    loadAccountLogs(fallback){
      return readJson(KEYS.accountLogs, fallback || []);
    },
    saveAccountLogs(rows){
      return writeJson(KEYS.accountLogs, rows || []);
    },

    loadProjects(fallback){
      return readJson(KEYS.projects, fallback || []);
    },
    saveProjects(rows){
      return writeJson(KEYS.projects, rows || []);
    },

    loadFormula(fallback){
      return readJson(KEYS.formula, fallback || null);
    },
    saveFormula(value){
      return writeJson(KEYS.formula, value || {});
    }
  };

  window.BM4DataStore = Store;
})(window);
