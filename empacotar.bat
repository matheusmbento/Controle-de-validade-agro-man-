@echo off
title Empacotar Sistema Pippo

echo ==============================================
echo   GERANDO VERSAO LIMPA PARA O CLIENTE
echo ==============================================
echo.

set DEST=Agro_Mane_Cliente
set ZIP_FILE=Agro_Mane_Cliente.zip

if exist "%DEST%" (
    echo Limpando pasta de build anterior...
    rmdir /s /q "%DEST%"
)
if exist "%ZIP_FILE%" (
    echo Deletando arquivo .zip antigo...
    del "%ZIP_FILE%"
)
mkdir "%DEST%"

echo Copiando arquivos essenciais...
copy iniciar.bat "%DEST%\" >nul
copy server.js "%DEST%\" >nul
copy telegram-bot.js "%DEST%\" >nul
copy baixar-offline.js "%DEST%\" >nul
copy index.html "%DEST%\" >nul
copy package.json "%DEST%\" >nul
if exist "package-lock.json" copy package-lock.json "%DEST%\" >nul
if exist "logo.png" copy logo.png "%DEST%\" >nul
if exist "logo.ico" copy logo.ico "%DEST%\" >nul

echo Copiando bibliotecas offline (se existirem)...
if exist "*.min.js" copy *.min.js "%DEST%\" >nul
if exist "tailwindcss.js" copy tailwindcss.js "%DEST%\" >nul

echo.
echo Compactando arquivos para o cliente...
powershell -command "Compress-Archive -Path '%DEST%' -DestinationPath '%ZIP_FILE%'"

if %errorlevel% neq 0 (
    echo.
    echo [ERRO] Falha ao compactar os arquivos.
    echo O PowerShell pode nao estar disponivel ou ocorreu um erro.
    echo A pasta '%DEST%' foi criada, mas nao foi zipada.
    echo.
) else (
    echo.
    echo [OK] Arquivo '%ZIP_FILE%' gerado com sucesso!
    echo Limpando pasta temporaria...
    rmdir /s /q "%DEST%"
    echo.
    echo [PRONTO] O arquivo para enviar ao cliente e: %ZIP_FILE%
)
echo.
pause