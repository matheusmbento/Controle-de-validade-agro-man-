@echo off
title Popula Banco - Agro Mane SQLite

echo ==============================================
echo    CRIANDO DADOS DE DEMONSTRACAO NO AGRO MANÉ
echo ==============================================
echo Certifique-se de que o servidor do Agro Mane ja esta rodando (iniciar.bat).
echo.
node popular-banco.js
echo.
pause