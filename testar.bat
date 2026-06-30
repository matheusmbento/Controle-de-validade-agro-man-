@echo off
title Teste de Regressao - Agro Mane SQLite

echo ==============================================
echo    AUDITORIA DO BANCO DE DADOS AGRO MANÉ
echo ==============================================
echo Certifique-se de que o servidor esta rodando.
echo.

node regression-test.js

echo.
pause