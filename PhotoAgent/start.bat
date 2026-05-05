@echo off
title PhotoAgent — Retouche Photo
cd /d "%~dp0"
cd app

echo.
echo  ============================================
echo   PhotoAgent — Agent de retouche photo
echo  ============================================
echo.

if not exist node_modules (
    echo  Installation des dependances npm...
    echo.
    call npm install
    echo.
)

echo  Demarrage du serveur...
start /b node index.js

echo  Ouverture du dashboard...
ping -n 3 127.0.0.1 > nul
start "" "http://localhost:3000"

echo.
echo  Agent actif sur http://localhost:3000
echo  Deposez vos images dans le dossier RAW
echo.
echo  Appuyez sur une touche pour arreter l'agent.
echo.
pause > nul

taskkill /f /im node.exe > nul 2>&1
echo  Agent arrete.
