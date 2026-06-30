// regression-test.js
// Teste de Regressão Automatizado para a API do Sistema Agro Mané

const API_URL = 'http://localhost:3000/api';

async function runTests() {
  console.log('🧪 Iniciando Testes de Regressão do Servidor Agro Mané...\n');
  let passed = 0;
  let failed = 0;

  // Função auxiliar para validar os resultados
  function assert(condition, message) {
    if (condition) {
      console.log(`✅ PASSOU: ${message}`);
      passed++;
    } else {
      console.error(`❌ FALHOU: ${message}`);
      failed++;
    }
  }

  try {
    // 1. Testar conexão básica (Servidor online?)
    const ping = await fetch(`${API_URL}/stock`);
    assert(ping.ok, 'Servidor está online e respondendo (GET /stock).');

    // 2. Testar Inserção de Produto (CREATE)
    const testItem = {
      id: 'test-' + Date.now(),
      ean: '9999999999999',
      name: 'Produto de Teste Regressivo',
      category: 'Panificação & Confeitaria',
      qty: 10,
      expiry: '2025-12-31'
    };

    const postRes = await fetch(`${API_URL}/stock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testItem)
    });
    const postData = await postRes.json();
    assert(postData.success === true, 'Criação de Produto no banco de dados (POST /stock).');

    // 3. Testar Leitura e Integridade dos Dados (READ)
    const getRes = await fetch(`${API_URL}/stock`);
    const getData = await getRes.json();
    const foundItem = getData.find(i => i.id === testItem.id);
    assert(foundItem !== undefined && foundItem.name === testItem.name, 'Leitura de Produto e integridade dos dados preservada.');

    // 4. Testar Atualização (UPDATE)
    testItem.name = 'Produto Modificado no Teste';
    testItem.qty = 25;
    const putRes = await fetch(`${API_URL}/stock/${testItem.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testItem)
    });
    const putData = await putRes.json();
    
    const getRes2 = await fetch(`${API_URL}/stock`);
    const getData2 = await getRes2.json();
    const updatedItem = getData2.find(i => i.id === testItem.id);
    assert(putData.success === true && updatedItem.qty === 25 && updatedItem.name === 'Produto Modificado no Teste', 'Atualização de Produto (PUT /stock/:id).');

    // 5. Testar Dicionário EAN (Memória Local Inteligente)
    const dictPostRes = await fetch(`${API_URL}/dict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ean: testItem.ean, name: testItem.name })
    });
    const dictPostData = await dictPostRes.json();
    const dictGetRes = await fetch(`${API_URL}/dict`);
    const dictGetData = await dictGetRes.json();
    assert(dictPostData.success === true && dictGetData[testItem.ean] === testItem.name, 'Registro e consulta de código EAN no Dicionário.');

    // 6. Testar Lógica de Lotes (Mesmo EAN e Validade = Soma de Quantidade)
    const loteDuplicado = { ...testItem, id: 'test-lote-2', qty: 5 }; // Adicionando mais 5 itens iguais
    await fetch(`${API_URL}/stock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(loteDuplicado)
    });
    const getResLote = await fetch(`${API_URL}/stock`);
    const getDataLote = await getResLote.json();
    const mergedItem = getDataLote.find(i => i.id === testItem.id);
    const ghostItem = getDataLote.find(i => i.id === 'test-lote-2');
    assert(mergedItem && mergedItem.qty === 30 && ghostItem === undefined, 'Lógica de Lotes: Soma automática de quantidades para EAN e Validade idênticos.');

    // 7. Testar Baixa Inteligente (Venda / Perda)
    const baixaRes = await fetch(`${API_URL}/estoque/baixar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: testItem.id, tipo_baixa: 'venda', quantidade: 10 })
    });
    const baixaData = await baixaRes.json();
    const getResBaixa = await fetch(`${API_URL}/stock`);
    const getDataBaixa = await getResBaixa.json();
    const itemPosBaixa = getDataBaixa.find(i => i.id === testItem.id);
    assert(baixaData.success === true && itemPosBaixa && itemPosBaixa.qty === 20, 'Baixa Inteligente: Redução correta da quantidade no estoque.');

    // 8. Testar Alimentação dos Relatórios (Raio-X)
    const ganhosRes = await fetch(`${API_URL}/relatorios/ganhos-detalhados`);
    const ganhosData = await ganhosRes.json();
    const registroVenda = ganhosData.find(i => i.name === testItem.name);
    assert(registroVenda !== undefined && registroVenda.total_qty >= 10, 'Relatórios Financeiros: Baixa registrada com sucesso no Histórico de Ganhos/Perdas.');

    // 9. Testar Configurações (Ajustes)
    await fetch(`${API_URL}/config`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'teste_telefone', value: '11999999999' }) });
    const confRes = await fetch(`${API_URL}/config`);
    const confData = await confRes.json();
    assert(confData['teste_telefone'] === '11999999999', 'Configurações: Persistência de preferências (Telefones) no banco.');

    // 10. Testar Tratamento de Erro (Baixa Maior que o Estoque)
    const badBaixaRes = await fetch(`${API_URL}/estoque/baixar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: testItem.id, tipo_baixa: 'venda', quantidade: 999 })
    });
    assert(badBaixaRes.status === 400, 'Proteção e Erros: Sistema bloqueia baixa com quantidade maior que o estoque real.');

    // 11. Testar Ajuste Saudável (Inventário Rápido)
    const ajusteRes = await fetch(`${API_URL}/estoque/ajuste-saudavel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: testItem.id, qtd_fisica: 5, qtd_vendida: 15 }) // O estoque estava em 20, passa a ser 5
    });
    const getResAjuste = await fetch(`${API_URL}/stock`);
    const itemAjustado = (await getResAjuste.json()).find(i => i.id === testItem.id);
    assert(ajusteRes.ok && itemAjustado && itemAjustado.qty === 5, 'Inventário Rápido: Ajuste Saudável corrige o estoque sem inflar os lucros.');

    // 12. Limpeza Final (DELETE)
    const delRes = await fetch(`${API_URL}/stock/${testItem.id}`, { method: 'DELETE' });
    const delData = await delRes.json();
    const getRes3 = await fetch(`${API_URL}/stock`);
    const getData3 = await getRes3.json();
    const deletedItem = getData3.find(i => i.id === testItem.id);
    assert(delData.success === true && deletedItem === undefined, 'Exclusão completa do Produto no banco (DELETE /stock/:id).');

  } catch (error) {
    console.error(`\n❌ ERRO DE CONEXÃO: ${error.message}`);
    console.error('Lembre-se: O servidor deve estar rodando (iniciar.bat) para os testes passarem.');
  }

  console.log(`\n📊 Resultado Final: ${passed} testes passaram, ${failed} falharam.`);
  if (failed === 0) {
    console.log('🎉 SISTEMA ESTÁVEL! Nenhuma falha encontrada no banco.');
  } else {
    process.exit(1);
  }
}

runTests();