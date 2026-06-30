const fs = require('fs');
const path = require('path');

async function downloadFile(url, filename) {
    console.log(`Baixando ${filename}...`);
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buffer = await res.arrayBuffer();
        fs.writeFileSync(path.join(__dirname, filename), Buffer.from(buffer));
        console.log(`✅ ${filename} salvo com sucesso!`);
    } catch (err) {
        console.error(`❌ Erro ao baixar ${filename}:`, err.message);
    }
}

async function run() {
    console.log('Iniciando o download das bibliotecas para modo Offline...\n');
    await downloadFile('https://unpkg.com/react@18/umd/react.production.min.js', 'react.min.js');
    await downloadFile('https://unpkg.com/react-dom@18/umd/react-dom.production.min.js', 'react-dom.min.js');
    await downloadFile('https://unpkg.com/@babel/standalone/babel.min.js', 'babel.min.js');
    await downloadFile('https://cdn.tailwindcss.com', 'tailwindcss.js');
    console.log('\n🎉 Todos os arquivos foram baixados! O sistema agora roda 100% sem internet.');
}

run();