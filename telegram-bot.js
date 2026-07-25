const sqlite3 = require('sqlite3').verbose();
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'database.sqlite'));

// Helpers
const today = () => { const d = new Date(); d.setHours(0,0,0,0); return d };
const parseDt = s => { if (!s) return null; const d = new Date(s+'T00:00:00'); d.setHours(0,0,0,0); return d };
const diffDays = s => { const p = parseDt(s); if (!p) return 9999; return Math.floor((p - today()) / 86400000) };
const statusOf = (s, cat) => {
  const d = diffDays(s);
  if (cat === 'Panificação & Confeitaria' || cat === 'Frios & Laticínios') {
    if (d < 5) return 'critical';
    if (d < 15) return 'warning';
    return 'ok';
  }
  if (d < 30) return 'critical';
  if (d < 60) return 'warning';
  return 'ok';
};

function getTelegramConfig() {
  return new Promise((resolve) => {
    db.all(`SELECT key, value FROM config WHERE key IN ('telegram_token', 'telegram_chat_id')`, [], (err, rows) => {
      if (err || !rows) return resolve({ token: null, chatId: null });
      const conf = {};
      rows.forEach(r => conf[r.key] = r.value);
      resolve({ token: conf.telegram_token, chatId: conf.telegram_chat_id });
    });
  });
}

function getConfig(key) {
  return new Promise((resolve) => {
    db.get(`SELECT value FROM config WHERE key = ?`, [key], (err, row) => {
      if (err || !row) return resolve(null);
      resolve(row.value);
    });
  });
}

function setConfig(key, value) {
  return new Promise((resolve) => {
    db.run(`INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)`, [key, value], (err) => {
      resolve(!err);
    });
  });
}

async function sendTelegramMessage(text) {
  const { token, chatId } = await getTelegramConfig();
  if (!token || !chatId) return console.log('⚠️ Telegram não configurado nos Ajustes.');
  
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'Markdown' })
    });
    if (!res.ok) throw new Error(await res.text());
    return true;
  } catch (err) {
    console.error('❌ Erro ao enviar Telegram:', err.message);
  }
}

async function sendTelegramDocument(filePath, caption) {
  const { token, chatId } = await getTelegramConfig();
  if (!token || !chatId) return console.log('⚠️ Telegram não configurado nos Ajustes.');

  try {
    const formData = new FormData();
    formData.append('chat_id', chatId);
    formData.append('caption', caption);
    
    const fileBuffer = fs.readFileSync(filePath);
    const blob = new Blob([fileBuffer]);
    formData.append('document', blob, path.basename(filePath));

    const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: 'POST',
      body: formData
    });
    if (!res.ok) throw new Error(await res.text());
    return true;
  } catch (err) {
    console.error('❌ Erro ao enviar Documento via Telegram:', err.message);
  }
}

async function sendCriticalStockAlert(isTest = false) {
    console.log('🔍 Verificando estoque crítico para alerta diário (Telegram)...');
    const todayStr = new Date().toISOString().slice(0, 10);
    db.all(`SELECT * FROM stock`, [], async (err, stock) => {
        if (err) return;
        const criticalItems = stock.filter(i => statusOf(i.expiry, i.category) === 'critical');

        if (criticalItems.length > 0) {
            let msg = `*ALERTA DE ESTOQUE CRÍTICO - AGRO MANÉ* 🚨\n\nOlá! Os seguintes produtos precisam de atenção imediata para evitar perdas:\n\n`;
            criticalItems.sort((a, b) => diffDays(a.expiry) - diffDays(b.expiry));
            
            criticalItems.forEach(item => {
                const days = diffDays(item.expiry);
                const dayText = days < 0 ? `VENCIDO HÁ ${Math.abs(days)} DIA(S)` : days === 0 ? 'VENCE HOJE!' : `Vence em ${days} dia(s)`;
                msg += `• *${item.name}* (${item.qty} un) - ${dayText}\n`;
            });
            msg += `\n_Aja rapidamente para aplicar descontos ou priorizar o uso._`;

            const ok = await sendTelegramMessage(msg);
            if (ok) {
                console.log(`📱 Alerta Telegram enviado com sucesso.`);
                if (!isTest) {
                    await setConfig('last_critical_alert_date', todayStr);
                }
            }
        } else {
            console.log(`🔍 Nenhum produto em estoque crítico hoje.`);
            if (!isTest) {
                await setConfig('last_critical_alert_date', todayStr);
            }
        }
    });
}

async function performBackup() {
  console.log('\n⏳ Iniciando rotina de backup (Telegram)...');
  const date = new Date().toISOString().slice(0, 10);
  const backupDir = path.join(__dirname, 'backups');
  const backupPath = path.join(backupDir, `backup-${date}.sqlite`);
  const dbPath = path.join(__dirname, 'database.sqlite');

  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir);

  if (fs.existsSync(dbPath)) {
    fs.copyFileSync(dbPath, backupPath);
    console.log(`✅ Backup local criado em: /backups/backup-${date}.sqlite`);
  } else return;

  try {
    const files = fs.readdirSync(backupDir);
    const backupFiles = files.filter(f => f.startsWith('backup-') && f.endsWith('.sqlite'))
      .map(f => ({ name: f, time: fs.statSync(path.join(backupDir, f)).mtime.getTime() }))
      .sort((a, b) => b.time - a.time);

    if (backupFiles.length > 7) {
      backupFiles.slice(7).forEach(file => fs.unlinkSync(path.join(backupDir, file.name)));
    }
  } catch (err) {}

  const msg = `Olá! 📦\n\nSegue o backup automático do banco de dados (*${date}*).\n\n*🛠 COMO RESTAURAR O SISTEMA SE O PC QUEBRAR:*\n1. Baixe este arquivo no PC novo.\n2. Renomeie o arquivo para \`database.sqlite\`.\n3. Coloque o arquivo dentro da pasta do seu Sistema Agro Mané (substituindo o antigo).\n4. Inicie o sistema normalmente!`;
  const ok = await sendTelegramDocument(backupPath, msg);
  if (ok) console.log(`📱 Arquivo de backup enviado via Telegram com sucesso!`);
}

function checkBootBackup() {
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const backupDir = path.join(__dirname, 'backups');
  
  if (!fs.existsSync(path.join(backupDir, `backup-${yesterday}.sqlite`)) && 
      !fs.existsSync(path.join(backupDir, `backup-${today}.sqlite`))) {
    performBackup();
  }
}

async function checkBootAlert() {
  const todayStr = new Date().toISOString().slice(0, 10);
  const lastAlertDate = await getConfig('last_critical_alert_date');
  if (lastAlertDate !== todayStr) {
    console.log('⏰ Alerta diário de estoque crítico não enviado hoje. Verificando/enviando agora...');
    await sendCriticalStockAlert(false);
  } else {
    console.log('✅ Alerta diário de estoque crítico já foi enviado hoje.');
  }
}

console.log('✅ Bot do Telegram rodando protegido em um processo paralelo!');

cron.schedule('55 18 * * *', performBackup);
cron.schedule('0 9 * * *', () => sendCriticalStockAlert(false));

// Comunicação (IPC) com o servidor principal Node.js
process.on('message', (msg) => {
  if (msg.action === 'test-alert') sendCriticalStockAlert(true);
  if (msg.action === 'send-message') sendTelegramMessage(msg.text);
  if (msg.action === 'test-backup') performBackup();
});