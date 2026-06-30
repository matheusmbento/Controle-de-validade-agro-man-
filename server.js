const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { fork } = require('child_process');

require('dotenv').config();
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// ================= HELPERS DE DATA E STATUS =================
const today    = () => { const d = new Date(); d.setHours(0,0,0,0); return d };
const parseDt  = s  => { if (!s) return null; const d = new Date(s+'T00:00:00'); d.setHours(0,0,0,0); return d };
const diffDays = s  => { const p = parseDt(s); if (!p) return 9999; return Math.floor((p - today()) / 86400000) };

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

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// ================= GERENCIADOR DE BANCO (SQLITE / POSTGRES) =================
const isPg = !!process.env.DATABASE_URL;
let pgPool;

if (isPg) {
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  console.log('☁️ Conectado ao banco em Nuvem (PostgreSQL).');
} else {
  console.log('✅ Conectado ao banco Local (SQLite).');
}

function convertToPg(sql) {
  if (!isPg) return sql;
  let pgSql = sql;
  let i = 1;
  while (pgSql.includes('?')) {
    pgSql = pgSql.replace('?', '$' + i);
    i++;
  }
  pgSql = pgSql.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'SERIAL PRIMARY KEY');
  pgSql = pgSql.replace(/AUTOINCREMENT/g, 'SERIAL');
  
  if (pgSql.includes('INSERT OR REPLACE INTO dict')) {
     pgSql = pgSql.replace(/INSERT OR REPLACE INTO dict \(ean, name\) VALUES \(\$1, \$2\)/, 'INSERT INTO dict (ean, name) VALUES ($1, $2) ON CONFLICT (ean) DO UPDATE SET name = EXCLUDED.name');
  }
  if (pgSql.includes('INSERT OR REPLACE INTO config')) {
     pgSql = pgSql.replace(/INSERT OR REPLACE INTO config \(key, value\) VALUES \(\$1, \$2\)/, 'INSERT INTO config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value');
  }
  return pgSql;
}

const db = isPg ? {
  serialize: (cb) => cb(),
  run: async (sql, params, cb) => {
    if (typeof params === 'function') { cb = params; params = []; }
    try {
      const res = await pgPool.query(convertToPg(sql), params || []);
      if (cb) cb.call({ lastID: null, changes: res.rowCount }, null);
    } catch (e) {
      if (cb) cb(e);
      else console.error('DB Error:', e.message);
    }
  },
  get: async (sql, params, cb) => {
    if (typeof params === 'function') { cb = params; params = []; }
    try {
      const res = await pgPool.query(convertToPg(sql), params || []);
      if (cb) cb(null, res.rows[0]);
    } catch (e) {
      if (cb) cb(e);
    }
  },
  all: async (sql, params, cb) => {
    if (typeof params === 'function') { cb = params; params = []; }
    try {
      const res = await pgPool.query(convertToPg(sql), params || []);
      if (cb) cb(null, res.rows);
    } catch (e) {
      if (cb) cb(e);
    }
  }
} : new sqlite3.Database('./database.sqlite', (err) => {
  if (err) console.error('Erro ao abrir o SQLite:', err.message);
});

// Cria as tabelas se elas não existirem
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS stock (
    id TEXT PRIMARY KEY,
    ean TEXT,
    name TEXT,
    category TEXT,
    qty INTEGER,
    expiry TEXT,
    price REAL,
    lote TEXT,
    ultimo_vendedor TEXT,
    atualizado_em TEXT
  )`);
  
  db.run(`ALTER TABLE stock ADD COLUMN price REAL`, (err) => { /* Ignora se a coluna já existir no banco */ });
  db.run(`ALTER TABLE stock ADD COLUMN lote TEXT`, (err) => { /* Ignora se a coluna já existir no banco */ });
  db.run(`ALTER TABLE stock ADD COLUMN ultimo_vendedor TEXT`, (err) => {});
  db.run(`ALTER TABLE stock ADD COLUMN atualizado_em TEXT`, (err) => {});

  db.run(`CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS historico_baixas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    produto_name TEXT,
    ean TEXT,
    quantidade INTEGER,
    preco_custo REAL,
    tipo_baixa TEXT,
    data_baixa TEXT,
    category TEXT,
    lote TEXT,
    usuario TEXT
  )`);
  
  db.run(`ALTER TABLE historico_baixas ADD COLUMN category TEXT`, (err) => { /* Ignora se a coluna já existir no banco */ });
  db.run(`ALTER TABLE historico_baixas ADD COLUMN lote TEXT`, (err) => { /* Ignora se a coluna já existir no banco */ });
  db.run(`ALTER TABLE historico_baixas ADD COLUMN usuario TEXT`, (err) => { /* Ignora se a coluna já existir no banco */ });

  db.run(`CREATE TABLE IF NOT EXISTS dict (
    ean TEXT PRIMARY KEY,
    name TEXT
  )`);
});

// ================= ROTAS DE ESTOQUE =================
app.get('/api/stock', (req, res) => {
  db.all(`SELECT * FROM stock ORDER BY expiry ASC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/stock', (req, res) => {
  const { id, ean, name, category, qty, expiry, price, lote, ultimo_vendedor, atualizado_em } = req.body;
  const finalLote = lote ? lote.trim() : '';
  const finalVendedor = ultimo_vendedor || 'Desconhecido';
  const finalAtualizado = atualizado_em || new Date().toISOString();
  
  db.get(`SELECT * FROM stock WHERE ean = ? AND expiry = ? AND COALESCE(lote, '') = ?`, [ean, expiry, finalLote], (err, row) => {
    // Se o EAN for igual, a Validade for igual, o Lote for igual e NÃO for um código gerado internamente: junta os lotes (soma as quantidades)
    if (row && ean && !ean.startsWith('INT-')) {
      db.run(`UPDATE stock SET qty = qty + ?, ultimo_vendedor = ?, atualizado_em = ? WHERE id = ?`, [qty, finalVendedor, finalAtualizado, row.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, updated: true });
      });
    } else { // Caso contrário (validades/lotes diferentes ou produtos internos únicos): separa em novos lotes
      db.run(`INSERT INTO stock (id, ean, name, category, qty, expiry, price, lote, ultimo_vendedor, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, ean, name, category, qty, expiry, price, finalLote, finalVendedor, finalAtualizado], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, inserted: true });
      });
    }
  });
});

app.put('/api/stock/:id', (req, res) => {
  const { ean, name, category, qty, expiry, price, lote, ultimo_vendedor, atualizado_em } = req.body;
  const finalLote = lote ? lote.trim() : '';
  const finalVendedor = ultimo_vendedor || 'Desconhecido';
  const finalAtualizado = atualizado_em || new Date().toISOString();
  db.run(`UPDATE stock SET ean = ?, name = ?, category = ?, qty = ?, expiry = ?, price = ?, lote = ?, ultimo_vendedor = ?, atualizado_em = ? WHERE id = ?`,
    [ean, name, category, qty, expiry, price, finalLote, finalVendedor, finalAtualizado, req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.delete('/api/stock/:id', (req, res) => {
  db.run(`DELETE FROM stock WHERE id = ?`, [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// ================= ROTA DE BAIXA INTELIGENTE =================
app.post('/api/estoque/baixar', (req, res) => {
  const { id, tipo_baixa, quantidade, usuario } = req.body;
  const usr = usuario || 'Desconhecido';
  if (!['venda', 'perda'].includes(tipo_baixa)) {
    return res.status(400).json({ error: 'Tipo de baixa inválido' });
  }

  db.get(`SELECT * FROM stock WHERE id = ?`, [id], (err, row) => {
    if (err || !row) return res.status(400).json({ error: 'Item não encontrado no estoque' });

    const qtyToDrop = quantidade ? parseInt(quantidade) : row.qty;
    
    if (isNaN(qtyToDrop) || qtyToDrop <= 0 || qtyToDrop > row.qty) {
        return res.status(400).json({ error: 'Quantidade inválida' });
    }

    db.run(`INSERT INTO historico_baixas (produto_name, ean, quantidade, preco_custo, tipo_baixa, data_baixa, category, lote, usuario) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.name, row.ean, qtyToDrop, row.price, tipo_baixa, new Date().toISOString(), row.category, row.lote, usr], function(err) {
      if (err) return res.status(500).json({ error: err.message });

      if (qtyToDrop === row.qty) {
        db.run(`DELETE FROM stock WHERE id = ?`, [id], function(err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ success: true });
        });
      } else {
        const remainingQty = row.qty - qtyToDrop;
        db.run(`UPDATE stock SET qty = ? WHERE id = ?`, [remainingQty, id], function(err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ success: true });
        });
      }
    });
  });
});

// ================= ROTA DE AJUSTE RÁPIDO (SAUDÁVEL) =================
app.post('/api/estoque/ajuste-saudavel', (req, res) => {
  const { id, qtd_fisica, qtd_vendida, usuario } = req.body;
  const usr = usuario || 'Desconhecido';
  
  db.get(`SELECT * FROM stock WHERE id = ?`, [id], (err, row) => {
    if (err || !row) return res.status(400).json({ error: 'Item não encontrado no estoque' });

    // Registra a baixa com preço_custo = 0 e um tipo de baixa diferente para não inflar o Raio-X de ganhos e perdas
    db.run(`INSERT INTO historico_baixas (produto_name, ean, quantidade, preco_custo, tipo_baixa, data_baixa, category, lote, usuario) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.name, row.ean, qtd_vendida, 0, 'venda_normal_saudavel', new Date().toISOString(), row.category, row.lote, usr], function(err) {
      if (err) return res.status(500).json({ error: err.message });

      if (qtd_fisica === 0) {
        db.run(`DELETE FROM stock WHERE id = ?`, [id], function(err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ success: true });
        });
      } else {
        db.run(`UPDATE stock SET qty = ? WHERE id = ?`, [qtd_fisica, id], function(err) {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ success: true });
        });
      }
    });
  });
});

// ================= ROTAS DE RELATÓRIO =================
app.get('/api/relatorios/perdas-detalhadas', (req, res) => {
  let { start, end } = req.query;
  if (!start || !end) {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    start = `${y}-${m}-01`;
    end = `${y}-${m}-${new Date(y, now.getMonth() + 1, 0).getDate()}`;
  }
  const startIso = start + "T00:00:00.000Z";
  const endIso = end + "T23:59:59.999Z";
  db.all(`SELECT id, COALESCE(category, 'Outros') as category, produto_name as name, quantidade as total_qty, (quantidade * preco_custo) as total_value, usuario, data_baixa FROM historico_baixas WHERE tipo_baixa = 'perda' AND data_baixa >= ? AND data_baixa <= ? ORDER BY data_baixa DESC`, [startIso, endIso], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/relatorios/ganhos-detalhados', (req, res) => {
  let { start, end } = req.query;
  if (!start || !end) {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    start = `${y}-${m}-01`;
    end = `${y}-${m}-${new Date(y, now.getMonth() + 1, 0).getDate()}`;
  }
  const startIso = start + "T00:00:00.000Z";
  const endIso = end + "T23:59:59.999Z";
  db.all(`SELECT id, COALESCE(category, 'Outros') as category, produto_name as name, quantidade as total_qty, (quantidade * preco_custo) as total_value, usuario, data_baixa FROM historico_baixas WHERE tipo_baixa = 'venda' AND data_baixa >= ? AND data_baixa <= ? ORDER BY data_baixa DESC`, [startIso, endIso], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/relatorios/baixas', (req, res) => {
  db.all(`SELECT * FROM historico_baixas ORDER BY data_baixa DESC LIMIT 100`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// ================= ROTA DE IMPORTAÇÃO JSON =================
app.post('/api/estoque/importar-json', async (req, res) => {
  const items = req.body;
  if (!Array.isArray(items)) {
    return res.status(400).json({ error: 'Formato inválido. Esperado um array de itens.' });
  }

  if (isPg) {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      for (const item of items) {
        await client.query(
          `INSERT INTO stock (id, ean, name, category, qty, expiry, price, lote) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [item.id, item.ean || '', item.name, item.category, item.qty, item.expiry, item.price || 0, item.lote || '']
        );
      }
      await client.query('COMMIT');
      res.json({ success: true, count: items.length });
    } catch (e) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: e.message });
    } finally {
      client.release();
    }
  } else {
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      const stmt = db.prepare(`INSERT INTO stock (id, ean, name, category, qty, expiry, price, lote) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      
      for (const item of items) {
        stmt.run(item.id, item.ean || '', item.name, item.category, item.qty, item.expiry, item.price || 0, item.lote || '');
      }
      
      stmt.finalize();
      db.run('COMMIT', (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, count: items.length });
      });
    });
  }
});

// ================= ROTA DE IMPORTAÇÃO XML =================
app.post('/api/estoque/importar-xml', (req, res) => {
  const xml = req.body.xml;
  if (!xml) return res.status(400).json({ error: 'XML não enviado' });

  const products = [];
  // Encontra cada produto dentro da tag <det nItem="..."> da NF-e
  const detRegex = /<det nItem=".*?">([\s\S]*?)<\/det>/g;
  let match;
  while ((match = detRegex.exec(xml)) !== null) {
    const detXml = match[1];
    const xProdMatch = detXml.match(/<xProd>(.*?)<\/xProd>/);
    const cEANMatch = detXml.match(/<cEAN>(.*?)<\/cEAN>/);
    const qComMatch = detXml.match(/<qCom>(.*?)<\/qCom>/);
    const vUnComMatch = detXml.match(/<vUnCom>(.*?)<\/vUnCom>/);
    const nLoteMatch = detXml.match(/<nLote>(.*?)<\/nLote>/);
    
    let cEAN = cEANMatch ? cEANMatch[1] : '';
    if (cEAN === 'SEM GTIN') cEAN = '';

    const lote = nLoteMatch ? nLoteMatch[1] : '';

    products.push({
      name: xProdMatch ? xProdMatch[1] : 'Produto Desconhecido',
      ean: cEAN,
      qty: qComMatch ? Math.round(parseFloat(qComMatch[1])) : 0,
      price: vUnComMatch ? parseFloat(vUnComMatch[1]) : 0,
      lote: lote
    });
  }

  // Verifica o dicionário interno para manter a padronização de nomes
  db.all(`SELECT * FROM dict`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const dict = {};
    rows.forEach(r => dict[r.ean] = r.name);

    const enrichedProducts = products.map(p => {
      if (p.ean && dict[p.ean]) p.name = dict[p.ean];
      return p;
    });
    res.json(enrichedProducts);
  });
});

// ================= ROTA DE RECEBIMENTO VIA DANFE =================
app.post('/api/recebimento/danfe', (req, res) => {
  const { chave } = req.body;
  if (!chave || chave.length !== 44) {
    return res.status(400).json({ error: 'Chave DANFE inválida. São necessários 44 dígitos.' });
  }

  // Simulação de integração com a SEFAZ (retorno dos produtos da nota fiscal)
  const simulatedProducts = [
    { ean: '7891010101010', name: 'PRODUTO SIMULADO 1', qty: 10, price: 5.50 },
    { ean: '7892020202020', name: 'PRODUTO SIMULADO 2', qty: 24, price: 2.30 },
    { ean: '',              name: 'PRODUTO SEM CÓDIGO', qty: 5,  price: 10.00 }
  ];

  // Verifica o dicionário interno para manter a padronização de nomes
  db.all(`SELECT * FROM dict`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const dict = {};
    rows.forEach(r => dict[r.ean] = r.name);

    const enrichedProducts = simulatedProducts.map(p => {
      if (p.ean && dict[p.ean]) p.name = dict[p.ean];
      return p;
    });
    
    res.json(enrichedProducts);
  });
});

// ================= ROTAS DE DICIONÁRIO =================
app.get('/api/dict', (req, res) => {
  db.all(`SELECT * FROM dict`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const dict = {};
    rows.forEach(r => dict[r.ean] = r.name);
    res.json(dict);
  });
});

app.post('/api/dict', (req, res) => {
  const { ean, name } = req.body;
  db.run(`INSERT OR REPLACE INTO dict (ean, name) VALUES (?, ?)`, [ean, name], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// ================= ROTAS DE CONFIGURAÇÃO =================
app.get('/api/config', (req, res) => {
  db.all(`SELECT * FROM config`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const config = {};
    rows.forEach(r => config[r.key] = r.value);
    res.json(config);
  });
});

app.post('/api/config', (req, res) => {
  const { key, value } = req.body;
  db.run(`INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)`, [key, value], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// ================= ROTA DE BUSCA EAN EXTERNA =================
app.get('/api/lookup-ean/:code', async (req, res) => {
  const code = req.params.code ? req.params.code.trim() : '';
  
  db.get(`SELECT name FROM dict WHERE ean = ?`, [code], (err, dictRow) => {
    if (dictRow && dictRow.name) {
      return res.json({ name: dictRow.name });
    }
    
    db.get(`SELECT name FROM stock WHERE ean = ? ORDER BY id DESC LIMIT 1`, [code], async (err, stockRow) => {
      if (stockRow && stockRow.name) {
        return res.json({ name: stockRow.name });
      }

      // Se não encontrou no banco local, faz a busca externa
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 7000);
      const fetchOpts = { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 AgroMane/1.0' } };

      async function tryOpenFood() {
        try {
          const r = await fetch(`https://world.openfoodfacts.org/api/v0/product/${code}.json`, fetchOpts);
          const d = await r.json();
          if (d.status === 1 && d.product) {
            return d.product.product_name_pt || d.product.product_name || d.product.product_name_en || null;
          }
        } catch (e) {}
        return null;
      }

      async function tryOpenBeauty() {
        try {
          const r = await fetch(`https://world.openbeautyfacts.org/api/v0/product/${code}.json`, fetchOpts);
          const d = await r.json();
          return (d.status === 1 && d.product?.product_name) ? d.product.product_name : null;
        } catch (e) {}
        return null;
      }

      async function tryUPCItemDB() {
        try {
          const r = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${code}`, fetchOpts);
          const d = await r.json();
          return (d.code === 'OK' && d.items?.length > 0) ? d.items[0].title : null;
        } catch (e) {}
        return null;
      }

      async function tryMercadoLivre() {
        try {
          const r = await fetch(`https://api.mercadolibre.com/sites/MLB/search?q=${encodeURIComponent(code)}&limit=3`, fetchOpts);
          const d = await r.json();
          const items = (d.results || []).filter(x => x.title && x.title.length > 3);
          return items.length > 0 ? items[0].title : null;
        } catch (e) {}
        return null;
      }

      try {
        const results = await Promise.allSettled([tryOpenFood(), tryOpenBeauty(), tryUPCItemDB(), tryMercadoLivre()]);
        clearTimeout(timer);
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value) return res.json({ name: r.value });
        }
      } catch (e) {
        console.error("Erro na busca EAN paralela:", e.message);
      }
      clearTimeout(timer);
      return res.json({ name: null });
    });
  });
});

// ================= ROTA DE DESLIGAMENTO =================
app.post('/api/shutdown', (req, res) => {
  res.json({ success: true, message: 'Desligando o servidor...' });
  console.log('🛑 Servidor encerrado pelo usuário via navegador.');
  setTimeout(() => process.exit(0), 500); // Fecha o terminal após 0.5s
});

// ================= ROTA DE TESTE MANUAL =================
app.post('/api/test-alert', (req, res) => {
  if (telegramProcess) {
    telegramProcess.send({ action: 'test-alert' });
  }
  res.json({ success: true, message: 'Alerta disparado pelo usuário!' });
});

// ================= ROTA DE TESTE DE BACKUP =================
app.post('/api/test-backup', (req, res) => {
  if (telegramProcess) {
    telegramProcess.send({ action: 'test-backup' });
  }
  res.json({ success: true, message: 'Backup disparado pelo usuário!' });
});

// ================= ROTA DE ENVIO DE MENSAGEM (FRONTEND -> TELEGRAM) =================
app.post('/api/send-message', (req, res) => {
  if (telegramProcess && req.body.text) {
    telegramProcess.send({ action: 'send-message', text: req.body.text });
  }
  res.json({ success: true });
});

// ================= GERENCIADOR DO PROCESSO DO TELEGRAM =================
let telegramProcess = null;

function startTelegramBot() {
  telegramProcess = fork(path.join(__dirname, 'telegram-bot.js'));
  
  telegramProcess.on('exit', (code) => {
    if (code !== 0) {
      console.error(`⚠️ Bot do Telegram caiu (Código ${code}). Reiniciando sozinho em 5 segundos...`);
      setTimeout(startTelegramBot, 5000);
    }
  });
}

// Inicializa o Servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
  startTelegramBot(); // Inicia o bot protegido contra quedas
});