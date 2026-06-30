const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const db = new sqlite3.Database(path.join(__dirname, 'database.sqlite'));

db.serialize(() => {
    db.run("DELETE FROM stock");
    db.run("DELETE FROM historico_baixas");
    console.log("✅ Produtos do estoque e histórico financeiro apagados com sucesso!");
    console.log("✅ Configuracoes do Telegram e nomes de EANs (Dicionario) foram mantidos.");
    console.log("🎉 O sistema esta limpo e pronto para entrega!");
});
db.close();