@echo off
title Inicializador - Sistema Agro Mané

echo Verificando pre-requisitos (Node.js)...
node -v >nul 2>&1
if %errorlevel% neq 0 (
    cls
    echo.
    echo =================================================================
    echo  ERRO: Node.js nao encontrado!
    echo =================================================================
    echo.
    echo  O Node.js e necessario para rodar este sistema.
    echo  Por favor, instale a versao LTS recomendada no site abaixo.
    echo.
    echo  Apos a instalacao, feche esta janela e rode o "iniciar.bat" de novo.
    echo.
    start "" "https://nodejs.org/"
    pause
    exit
)

if not exist "node_modules\" (
    echo Primeira execucao: Instalando dependencias do projeto ^(isso pode demorar^)...
    call npm init -y > nul 2>&1
    call npm install express sqlite3 cors node-cron > nul 2>&1
) else (
    echo Dependencias ja encontradas. Pulando instalacao...
)

if not exist "react.min.js" (
    echo Baixando bibliotecas visuais para o modo Offline...
    node baixar-offline.js
)

echo.
echo Iniciando o servidor do banco de dados...
start "Servidor Agro Mané SQLite" cmd /k "node server.js"

echo Aguardando inicializacao...
timeout /t 3 /nobreak > nul

echo.
echo Abrindo o sistema no navegador...
start http://localhost:3001/index.html

exit