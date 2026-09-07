#!/usr/bin/env node
/**
 * payload.json の「案件」セクションを最新化する。
 *
 *   node refresh.js
 *
 * 読むもの
 *   事業創発室 案件マスタ（GSheet）… サービスアカウントで読む（読み取り専用）
 *
 * ★2026-09-07 の改修（結 0905便）
 *   それまでは index.html にマスタのシートIDが平文で入っており、ブラウザが gviz で
 *   毎回読んでいた。そのシートは「リンクを知っている全員が閲覧可」だったので、
 *   公開URLを見た人が主担当・次アクション・関与メンバーまで読める状態だった。
 *   ここでサーバ側で読み、build.js が payload をまるごと暗号化する形に移した。
 *
 * 書くもの
 *   payload.json の projects セクションのみ（他は触らない）
 */
const fs = require('fs');
const path = require('path');
const { readRange } = require('./lib/gsheet');

/** 置き場と識別子はリポジトリに書かない。環境変数 → config.local.json（.gitignore済み） */
function localConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.local.json'), 'utf8'));
  } catch (e) {
    return {};
  }
}
const CFG = localConfig();

function need(name, key) {
  const v = process.env[name] || CFG[key];
  if (!v) {
    console.error(
      '[refresh] ' + name + ' が未設定です。\n' +
      '  環境変数 ' + name + ' を渡すか、config.local.json に "' + key + '" を書いてください。\n' +
      '  （値は社内の運用メモを参照。このリポジトリには書きません）'
    );
    process.exit(2);
  }
  return v;
}

const SA_PATH = need('SOHATSU_SA', 'saPath');
const PAYLOAD = need('SOHATSU_PAYLOAD', 'payloadPath');
const MASTER_ID = need('SOHATSU_MASTER_SHEET_ID', 'masterSheetId');

function fmt(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 案件マスタの13列をそのまま持つ。
 * ★列名でのマッピングはページ側に任せる（マスタで列名を変えたらページで気づける）。
 *   ただし要る列が消えていたらここで止める＝黙って空のページを出さない。
 */
async function projects() {
  const rows = await readRange(SA_PATH, MASTER_ID, 'A1:M200');
  if (!rows.length) throw new Error('案件マスタが空です');
  const head = rows[0].map(h => (h || '').trim());
  const need = ['種別', '案件番号', '業務名', '主担当', '状態', '次アクション', '期限'];
  const miss = need.filter(n => !head.includes(n));
  if (miss.length) throw new Error('案件マスタの見出しに ' + miss.join('・') + ' がありません');
  const iName = head.indexOf('業務名');
  const body = rows.slice(1).filter(r => r && (r[iName] || '').trim());
  return {
    as_of: fmt(new Date()),
    head,
    rows: body.map(r => head.map((_, i) => (r[i] == null ? '' : String(r[i])))),
  };
}

(async () => {
  let p = {};
  if (fs.existsSync(PAYLOAD)) {
    p = JSON.parse(fs.readFileSync(PAYLOAD, 'utf8'));
  } else {
    console.log('payload.json が無いので新しく作ります:', PAYLOAD);
  }

  try {
    p.projects = await projects();
    const byType = {};
    p.projects.rows.forEach(r => {
      const t = r[p.projects.head.indexOf('種別')] || '（種別なし）';
      byType[t] = (byType[t] || 0) + 1;
    });
    console.log(`案件マスタ: ${p.projects.rows.length}行を取り込み（${p.projects.as_of} 時点）`);
    console.log('  種別ごと: ' + Object.entries(byType).map(([k, v]) => `${k} ${v}`).join('／'));
  } catch (e) {
    //: ★落ちても payload の前回値は残す。ページは「◯時点」が古いまま出るので、
    //   黙って空になることはない
    console.error('案件マスタの取得に失敗:', e.message);
    process.exitCode = 1;
  }

  fs.mkdirSync(path.dirname(PAYLOAD), { recursive: true });
  fs.writeFileSync(PAYLOAD, JSON.stringify(p, null, 2) + '\n', 'utf8');
  console.log('書き込み:', PAYLOAD);
  console.log('→ 続けて  SOHATSU_PASS=\'合言葉\' node build.js  でページを生成してください');
})();
