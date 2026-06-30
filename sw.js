// Service Worker minimalista apenas para habilitar a instalação como PWA
// sem fazer cache de arquivos, permitindo que a rede sempre busque os dados reais do seu servidor

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // Apenas repassa a requisição diretamente para a rede, sem cachear.
  // Isso evita erros de "não foi possível obter" se o banco ou arquivos mudarem no servidor.
  return; 
});
