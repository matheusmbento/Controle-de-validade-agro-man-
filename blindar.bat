@echo off
title Blindagem do Sistema Agro Mane
echo.
echo Ocultando e protegendo a pasta atual contra exclusao acidental...
attrib +h +s "%CD%"
echo.
echo ✅ Pasta blindada com sucesso! Ela agora esta invisivel no Windows.
echo (O atalho na Area de Trabalho continuara funcionando perfeitamente)
pause