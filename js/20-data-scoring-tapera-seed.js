// Perumahan/POI data, Tapera seed, market context
// ============================================================
// KOMPETITOR & POI DATA
// ============================================================
let perumahan=[
  {id:1,nama:"GRIYA WIJAYA CIBOGO",lat:-6.5578890,lng:107.8131269,tipe:"mix",realisasi:0,unit:1000,tahun:2023,developer:"PT WIJAYA INTAN NURYAKSA",area:"Cibogo"},
  {id:2,nama:"GRIYA PUTRA RESIDENCE",lat:-6.5800351,lng:107.7797321,tipe:"subsidi",realisasi:100,unit:120,tahun:2024,developer:"PT BUMI CAHAYA PUTRA",area:"Subang Kota"},
  {id:3,nama:"GRAHA VILLAGE PURWADADI",lat:-6.4715672,lng:107.664008,tipe:"mix",realisasi:200,unit:80,tahun:2024,developer:"PT CIPTA WARNA PROPERTINDO",area:"Purwadadi"},
  {id:4,nama:"KALIS RESIDENCE 2",lat:-6.5190817,lng:107.7829784,tipe:"subsidi",realisasi:300,unit:80,tahun:2024,developer:"PT BUKIT JAYA PROPERTI",area:"Pagaden"},
  {id:5,nama:"PRIMA TALAGA SUNDA",lat:-6.5627312,lng:107.7384974,tipe:"mix",realisasi:70,unit:80,tahun:2024,developer:"PT KOPRIMA SANDYSEJAHTERA",area:"Subang Kota"},
  {id:6,nama:"BUMI GEMILANG ASRI 2",lat:-6.5235201,lng:107.6789249,tipe:"subsidi",realisasi:70,unit:80,tahun:2024,developer:"PT MUGI MUKTI MUGHNI",area:"Kalijati"},
  {id:7,nama:"GRAND SUBANG RESIDENCE",lat:-6.5412470,lng:107.7941358,tipe:"subsidi",realisasi:70,unit:80,tahun:2024,developer:"PT CENTRAL VIRGINIA DEVELOPMENT",area:"Cibogo"},
  {id:8,nama:"HARVA GRAND CITY",lat:-6.5301219,lng:107.7758048,tipe:"subsidi",realisasi:70,unit:80,tahun:2024,developer:"PT HARVA JAYA MANDIRI",area:"Subang Kota"},
  {id:9,nama:"STAVIA RESIDENCE",lat:-6.5791547,lng:107.7514259,tipe:"subsidi",realisasi:70,unit:80,tahun:2024,developer:"PT WAHANA ADIDAYA BANGUN",area:"Subang Kota"},
  {id:10,nama:"BUANA SUBANG RAYA 2",lat:-6.5231573,lng:107.773106,tipe:"mix",realisasi:70,unit:80,tahun:2024,developer:"PT CIKAL BUANA PERSADA",area:"Subang Kota"},
  {id:11,nama:"THE GREEN PAGADEN",lat:-6.4504546,lng:107.7882484,tipe:"subsidi",realisasi:70,unit:80,tahun:2024,developer:"PT PERMATA TRI MANDIRI",area:"Pagaden"},
  {id:12,nama:"GRIYA INSUN MEDAL",lat:-6.5324273,lng:107.7641417,tipe:"subsidi",realisasi:70,unit:80,tahun:2024,developer:"PT ARTHA LAND PROPERTINDO",area:"Subang Kota"},
  {id:13,nama:"NUANSA SALAM JAYA",lat:-6.4257767,lng:107.5756779,tipe:"subsidi",realisasi:70,unit:80,tahun:2024,developer:"PT FAQIH PROPERTY MANDIRI",area:"Pabuaran"},
  {id:14,nama:"KALIS RESIDENCE TAHAP 2",lat:-6.5190817,lng:107.7829784,tipe:"subsidi",realisasi:70,unit:80,tahun:2024,developer:"PT MITRA BORNEO PROPERTI",area:"Pagaden"},
  {id:15,nama:"KAMPOENG HIJAU",lat:-6.5203685,lng:107.678239,tipe:"subsidi",realisasi:70,unit:80,tahun:2023,developer:"PT ROMAN MULTI PROPERTIES",area:"Kalijati"},
  {id:16,nama:"MAHKOTA GRAHA",lat:-6.5714464,lng:107.7748076,tipe:"subsidi",realisasi:70,unit:80,tahun:2020,developer:"PT LIDER BAHTERA TOOLSINDO",area:"Subang Kota"},
  {id:17,nama:"SUBANG GREEN CITY",lat:-6.5539431,lng:107.8029213,tipe:"mix",realisasi:70,unit:80,tahun:2017,developer:"PT GRAHAPRIMA SUKSESUTAMA",area:"Cibogo"},
];
const poi=[
  {nama:"RSUD Subang",lat:-6.557257,lng:107.747284,kat:"rs",label:"RS",emoji:"🏥"},
  {nama:"RS Mitra Plumbon",lat:-6.543243,lng:107.779872,kat:"rs",label:"RS",emoji:"🏥"},
  {nama:"RS HAMORI Pagaden",lat:-6.527665,lng:107.791289,kat:"rs",label:"RS",emoji:"🏥"},
  {nama:"RS PTPN VIII Subang",lat:-6.568158,lng:107.762698,kat:"rs",label:"RS",emoji:"🏥"},
  {nama:"Klinik Hasna Medika",lat:-6.559860,lng:107.777137,kat:"rs",label:"RS",emoji:"🏥"},
  {nama:"Universitas Subang",lat:-6.577598,lng:107.782929,kat:"kampus",label:"U",emoji:"🎓"},
  {nama:"Politeknik Negeri Subang (Cibogo)",lat:-6.553000,lng:107.810000,kat:"kampus",label:"U",emoji:"🎓"},
  {nama:"Politeknik Negeri Subang (Ciereng)",lat:-6.570000,lng:107.768000,kat:"kampus",label:"U",emoji:"🎓"},
  {nama:"Yogya Grand Subang",lat:-6.563381,lng:107.766748,kat:"mall",label:"M",emoji:"🏬"},
  {nama:"Pasar Pujasera Subang",lat:-6.569098,lng:107.759447,kat:"mall",label:"M",emoji:"🏬"},
  {nama:"Exit Tol Subang",lat:-6.531840,lng:107.783652,kat:"tol",label:"T",emoji:"🛣️"},
  {nama:"Exit Tol Kalijati",lat:-6.509211,lng:107.678693,kat:"tol",label:"T",emoji:"🛣️"},
  {nama:"Stasiun Pagadenbaru",lat:-6.487000,lng:107.792000,kat:"tol",label:"S",emoji:"🚆"},
  {nama:"Kantor Bupati Subang",lat:-6.571548,lng:107.762397,kat:"pemda",label:"G",emoji:"🏛️"},
  {nama:"Komplek Perkantoran Kab. Subang",lat:-6.572743,lng:107.762607,kat:"pemda",label:"G",emoji:"🏛️"},
  {nama:"Taifa Industrial Estate",lat:-6.516994,lng:107.801795,kat:"industri",label:"I",emoji:"💼"},
  {nama:"Subang Smartpolitan",lat:-6.480000,lng:107.620000,kat:"industri",label:"I",emoji:"💼"},
  {nama:"Kawasan Industri Cibogo",lat:-6.538337,lng:107.834849,kat:"industri",label:"I",emoji:"💼"},
  {nama:"Alun-Alun Kabupaten Subang",lat:-6.569800,lng:107.759800,kat:"publik",label:"P",emoji:"🌳"},
  {nama:"Lapang Bintang Kota Subang",lat:-6.562000,lng:107.763000,kat:"publik",label:"P",emoji:"🌳"},
  {nama:"Stadion Persikas",lat:-6.558000,lng:107.755000,kat:"publik",label:"P",emoji:"⚽"},
];
const KAT_COLOR={rs:"#DC2626",kampus:"#059669",mall:"#7C3AED",tol:"#475569",pemda:"#1D4ED8",industri:"#92400E",publik:"#0891B2"};
const KAT_LABEL={rs:"RS/Klinik",kampus:"Kampus",mall:"Mall/Belanja",tol:"Transportasi",pemda:"Pemerintah",industri:"Industri",publik:"Ruang Publik"};
const TIPE_COLOR={subsidi:"#65A30D",mix:"#B45309"};
const TIPE_BG={subsidi:"#ECFCCB",mix:"#FEF3C7"};
const TIPE_LABEL={subsidi:"Subsidi",mix:"Mix-use"};
const ANCHOR_ID=1;

// ============================================================
// [P0 TAPERA] Data Tapera — field tambahan per perumahan + konteks pasar kabupaten
// ============================================================
// Struktur tapera per perumahan (opsional, backward compat via optional chain):
// {lastSynced, totalRealisasi, nominalFLPP, realisasiBulanan:[{bulan,unit}],
//  hargaRange, luasTanah, luasBangunan, tenorDominan, uangMukaRange, bankDominan,
//  profilPembeli:{pekerjaan,usia,penghasilan,gender}}

let MARKET_CONTEXT = {
  lastSynced: '2026-04-23',
  kabupaten: 'SUBANG',
  totalPerumahanTerdaftar: 132,
  totalUnit: 26647,
  totalTerjual: 17513,
  totalKavling: 8665,
  totalReadyStock: 295,
  totalDibooking: 157,
  totalPembangunan: 17,
  pctSubsidi: 91.86,
  pctKomersil: 8.14
};
function loadMarketContext(){
  try{ const s=localStorage.getItem('bm4_market_ctx'); if(s) MARKET_CONTEXT={...MARKET_CONTEXT, ...JSON.parse(s)}; }catch(_){}
}
function saveMarketContext(){
  try{ localStorage.setItem('bm4_market_ctx', JSON.stringify(MARKET_CONTEXT)); }catch(_){}
}
loadMarketContext();

// Helper: generate realisasi bulanan dummy untuk seed (24 bulan 2024-01 → 2025-12)
function _genBulananDummy(total, peak){
  const months=[];
  for(let y=2024;y<=2025;y++) for(let m=1;m<=12;m++) months.push(`${y}-${String(m).padStart(2,'0')}`);
  // distribusi: awal sedikit, naik ke puncak, lalu turun
  const curve=months.map((_,i)=>{
    const x=(i-12)/6; return Math.max(0, Math.round(peak*Math.exp(-x*x)));
  });
  const sum=curve.reduce((a,b)=>a+b,0);
  const scale=total/sum;
  return months.map((bulan,i)=>({bulan, unit:Math.round(curve[i]*scale)}));
}
// Seed dummy ke 3 perumahan contoh — pakai struktur realistis dari PDF Tapera
(function seedTaperaDummy(){
  const dummies = {
    2: { // GRIYA PUTRA RESIDENCE (mirip TOP PUTRA)
      totalRealisasi: 100, nominalFLPP: 12.8, peak: 12,
      harga: '150-175 Jt', lt:'60-90 m²', lb:'26-31 m²',
      tenor:'15-20 Tahun', um:'2-3%', bank:'BTN',
      profil: { pekerjaan:{swasta:85, wiraswasta:10, other:5}, usia:{'19-25':42,'26-30':28,'31-35':16,'36-40':9,'40+':5}, penghasilan:{'3-4Jt':30,'4-5Jt':40,'5-6Jt':18,'6-8Jt':8,other:4}, gender:{L:58, P:42} }
    },
    5: { // PRIMA TALAGA SUNDA
      totalRealisasi: 70, nominalFLPP: 8.9, peak: 8,
      harga: '150-175 Jt', lt:'60-90 m²', lb:'26-31 m²',
      tenor:'10-15 Tahun', um:'UM ≤ 1%', bank:'BTN',
      profil: { pekerjaan:{swasta:78, wiraswasta:15, other:7}, usia:{'19-25':38,'26-30':32,'31-35':18,'36-40':8,'40+':4}, penghasilan:{'3-4Jt':42,'4-5Jt':32,'5-6Jt':16,'6-8Jt':7,other:3}, gender:{L:62, P:38} }
    },
    6: { // BUMI GEMILANG ASRI 2
      totalRealisasi: 70, nominalFLPP: 9.1, peak: 7,
      harga: '150-175 Jt', lt:'60-90 m²', lb:'26-31 m²',
      tenor:'15-20 Tahun', um:'2-3%', bank:'BTN',
      profil: { pekerjaan:{swasta:82, wiraswasta:12, other:6}, usia:{'19-25':35,'26-30':30,'31-35':20,'36-40':10,'40+':5}, penghasilan:{'3-4Jt':28,'4-5Jt':38,'5-6Jt':20,'6-8Jt':10,other:4}, gender:{L:55, P:45} }
    }
  };
  Object.entries(dummies).forEach(([id,d])=>{
    const p = perumahan.find(x=>x.id===parseInt(id));
    if(!p) return;
    p.tapera = {
      lastSynced: '2026-04-23',
      totalRealisasi: d.totalRealisasi,
      nominalFLPP: d.nominalFLPP,
      realisasiBulanan: _genBulananDummy(d.totalRealisasi, d.peak),
      hargaRange: d.harga, luasTanah: d.lt, luasBangunan: d.lb,
      tenorDominan: d.tenor, uangMukaRange: d.um, bankDominan: d.bank,
      profilPembeli: d.profil,
      _dummy: true
    };
  });
})();

// [v17 fix] Seed dummy Tapera ke SEMUA perumahan lain yang belum punya data.
// Tujuannya supaya user bisa lihat tampilan tabel banding dengan data di semua kolom.
// Tandai _dummyAuto:true supaya bisa dibedakan dari seed asli (_dummy:true) dan data user (tanpa flag).
(function seedTaperaDummyAll(){
  // Pseudo-random deterministic berdasarkan seed (id) supaya nilai reproducible per reload
  function rng(seed){ let x = seed * 9301 + 49297; return ()=>{ x = (x*9301 + 49297) % 233280; return x/233280; }; }
  const hargaOpts = ['140-160 Jt','150-175 Jt','155-170 Jt','160-180 Jt','165-185 Jt','170-190 Jt'];
  const ltOpts = ['54-72 m²','60-84 m²','60-90 m²','66-96 m²','72-100 m²'];
  const lbOpts = ['24-28 m²','26-31 m²','27-33 m²','30-36 m²','32-40 m²'];
  const tenorOpts = ['10-15 Tahun','15-20 Tahun','15-20 Tahun','20 Tahun','20-25 Tahun'];
  const umOpts = ['UM ≤ 1%','1-2%','2-3%','2-3%','3-5%'];
  const bankOpts = ['BTN','BTN','BTN Syariah','BRI','BNI'];

  perumahan.forEach(p=>{
    if(p.tapera) return; // skip yang sudah ada (id 2, 5, 6 dari seed asli)
    const r = rng(p.id || 1);
    // Total realisasi skala dari p.realisasi; clamp 20-300
    const totalReal = Math.max(20, Math.min(300, Math.round((p.realisasi||60) * (0.8 + r()*0.5))));
    const peak = Math.max(4, Math.round(totalReal / 8 + r()*6));
    const nominalFLPP = +(totalReal * (0.12 + r()*0.03)).toFixed(1); // ~12-15% dari total realisasi
    // Profil pembeli: generate persen dengan variasi
    const swastaPct = 60 + Math.round(r()*30);
    const wiraPct = Math.round((100-swastaPct) * (0.5 + r()*0.3));
    const otherPct = 100 - swastaPct - wiraPct;
    const g_L = 45 + Math.round(r()*25);
    p.tapera = {
      lastSynced: '2026-04-23',
      totalRealisasi: totalReal,
      nominalFLPP: nominalFLPP,
      realisasiBulanan: _genBulananDummy(totalReal, peak),
      hargaRange: hargaOpts[Math.floor(r()*hargaOpts.length)],
      luasTanah: ltOpts[Math.floor(r()*ltOpts.length)],
      luasBangunan: lbOpts[Math.floor(r()*lbOpts.length)],
      tenorDominan: tenorOpts[Math.floor(r()*tenorOpts.length)],
      uangMukaRange: umOpts[Math.floor(r()*umOpts.length)],
      bankDominan: bankOpts[Math.floor(r()*bankOpts.length)],
      profilPembeli: {
        pekerjaan: {swasta: swastaPct, wiraswasta: wiraPct, other: otherPct},
        usia: {
          '19-25': 30 + Math.round(r()*15),
          '26-30': 25 + Math.round(r()*10),
          '31-35': 15 + Math.round(r()*10),
          '36-40': 8 + Math.round(r()*6),
          '40+': 4 + Math.round(r()*4)
        },
        penghasilan: {
          '3-4Jt': 25 + Math.round(r()*15),
          '4-5Jt': 30 + Math.round(r()*15),
          '5-6Jt': 15 + Math.round(r()*8),
          '6-8Jt': 6 + Math.round(r()*6),
          'other': 3 + Math.round(r()*4)
        },
        gender: {L: g_L, P: 100 - g_L}
      },
      _dummyAuto: true // flag untuk bedakan dari seed asli
    };
  });
})();


// ============================================================
// TARGET PASAR DATA
// ============================================================
const STATUS_STEPS=[{label:'Identifikasi',icon:'🔍'},{label:'Kontak Awal',icon:'📞'},{label:'Presentasi',icon:'🤝'},{label:'Negosiasi',icon:'💬'},{label:'Deal',icon:'✅'}];
const STATUS_COLOR=['#94A3B8','#2563EB','#7C3AED','#D97706','#15803D'];
let tpTargets=JSON.parse(localStorage.getItem('bm4_tp_targets')||'null')||[
  {id:1,nama:'PT Taifa Industrial Estate',jenis:'kawasan',lat:-6.516994,lng:107.801795,karyawan:5000,pic:'Bagian Marketing - 0811-xxxx',lastcontact:'2026-04-01',status:1,catatan:'Sudah kenalan dengan security, perlu cari kontak HRD.'},
  {id:2,nama:'PT Subang Smartpolitan',jenis:'kawasan',lat:-6.480000,lng:107.620000,karyawan:8000,pic:'Belum ada',lastcontact:'-',status:0,catatan:'Kawasan industri besar, estimasi ribuan karyawan.'},
  {id:3,nama:'PT Kahatex Subang',jenis:'pabrik',lat:-6.525000,lng:107.782000,karyawan:2000,pic:'Bu Sari HRD - 0812-xxxx',lastcontact:'2026-04-10',status:2,catatan:'Sudah presentasi ke HRD, mereka tertarik program KPR subsidi.'},
  {id:4,nama:'PT Indofood CBP Subang',jenis:'pabrik',lat:-6.558000,lng:107.810000,karyawan:1500,pic:'Pak Budi - 0813-xxxx',lastcontact:'2026-03-20',status:1,catatan:'Sudah hubungi, jadwal meeting masih koordinasi.'},
  {id:5,nama:'PT Len Industri',jenis:'perusahaan',lat:-6.572000,lng:107.763000,karyawan:800,pic:'Belum ada',lastcontact:'-',status:0,catatan:'BUMN elektronik, karyawan banyak di area Subang kota.'},
  {id:6,nama:'PT Perkebunan PTPN VIII',jenis:'perusahaan',lat:-6.568000,lng:107.762000,karyawan:600,pic:'Pak Hendra - 0814-xxxx',lastcontact:'2026-04-15',status:3,catatan:'Negosiasi harga, mereka minta diskon kolektif untuk 20 unit.'},
  {id:7,nama:'PT Kawasan Industri Cibogo',jenis:'kawasan',lat:-6.538337,lng:107.834849,karyawan:3000,pic:'Belum ada',lastcontact:'-',status:0,catatan:'Dekat dengan proyek kita, prioritas untuk didekati.'},
  {id:8,nama:'PT Kimia Farma Subang',jenis:'pabrik',lat:-6.545000,lng:107.775000,karyawan:400,pic:'Bu Wati HR - 0815-xxxx',lastcontact:'2026-04-05',status:2,catatan:'Sudah presentasi, menunggu approval manajemen.'},
];
let tpMap=null,tpMapInit=false,tpMarkers={},selectedTpId=null,tpFilter='semua',editingTpId=-1;
