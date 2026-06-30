// popular-banco.js
// Script para popular o banco de dados do Sistema Agro Mané para demonstrações

const API_URL = 'http://localhost:3000/api';

const categorias = ['Panificação & Confeitaria', 'Bebidas', 'Frios e Laticínios', 'Mercearia', 'Bomboniere', 'Higiene e Limpeza'];
const produtosBase = ['Pão Francês', 'Pão de Forma', 'Bolo de Chocolate', 'Suco de Laranja', 'Refrigerante Cola', 'Queijo Mussarela', 'Presunto', 'Biscoito Recheado', 'Iogurte Morango', 'Café Torrado', 'Manteiga', 'Leite Integral', 'Salgadinho', 'Água Mineral'];
const variantes = ['Premium', 'Light', 'Zero', 'Tradicional', 'Especial', 'Integral', 'Artesanal', 'Family'];

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getRandomDate() {
    const start = new Date();
    const end = new Date();
    end.setFullYear(start.getFullYear() + 1); // Validades de hoje até 1 ano para frente
    const date = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
    return date.toISOString().split('T')[0]; // Formato YYYY-MM-DD
}

function generateEAN() {
    // Gera um código de barras de 13 dígitos começando com 789 (Brasil)
    return '789' + Math.floor(Math.random() * 10000000000).toString().padStart(10, '0');
}

async function popularBanco() {
    console.log('🚀 Iniciando a injeção de 100 produtos no Sistema Agro Mané...\n');
    let inseridos = 0;
    let idsParaVenda = [];

    // 1. Inserir 100 Produtos
    for (let i = 1; i <= 100; i++) {
        const base = produtosBase[getRandomInt(0, produtosBase.length - 1)];
        const varte = variantes[getRandomInt(0, variantes.length - 1)];
        const cat = categorias[getRandomInt(0, categorias.length - 1)];
        
        const item = {
            id: 'demo-' + Date.now() + '-' + i,
            ean: generateEAN(),
            name: `${base} ${varte} (Lote ${i})`,
            category: cat,
            qty: getRandomInt(10, 150),
            expiry: getRandomDate()
        };

        try {
            const res = await fetch(`${API_URL}/stock`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(item)
            });
            if (res.ok) {
                inseridos++;
                idsParaVenda.push(item.id);
            }
        } catch(e) {
            console.error(`❌ Erro ao inserir produto ${i}:`, e.message);
        }
    }
    
    console.log(`✅ ${inseridos} produtos cadastrados com sucesso!\n`);
    console.log('💸 Simulando vendas para gerar dados no Dashboard Financeiro...');

    // 2. Simular 40 Vendas Aleatórias
    let vendas = 0;
    for(let i = 0; i < 40; i++) {
        const idRandom = idsParaVenda[getRandomInt(0, idsParaVenda.length - 1)];
        try {
            const res = await fetch(`${API_URL}/estoque/baixar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: idRandom, tipo_baixa: 'venda', quantidade: getRandomInt(1, 5) })
            });
            if(res.ok) vendas++;
        } catch(e) {}
    }
    console.log(`✅ ${vendas} vendas simuladas com sucesso!\n`);
    console.log('🎉 Tudo pronto! O banco de dados está populado e pronto para a demonstração.');
}

popularBanco();