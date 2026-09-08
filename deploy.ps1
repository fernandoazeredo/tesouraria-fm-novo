$ErrorActionPreference = 'Stop'

$ProjectId = 'tesouraria-fm-novo'
$ExpectedFolderName = 'TESOURARIA_FM_NOVO'

Write-Host ''
Write-Host '=============================================' -ForegroundColor Cyan
Write-Host ' TESOURARIA FM NOVO - DEPLOY FIREBASE' -ForegroundColor Cyan
Write-Host '=============================================' -ForegroundColor Cyan
Write-Host "Projeto Firebase: $ProjectId"
Write-Host "Pasta atual: $((Get-Location).Path)"
Write-Host ''

if (-not (Test-Path '.\package.json')) {
  throw 'package.json nao encontrado. Execute este script na raiz do projeto.'
}

if ((Split-Path -Leaf (Get-Location).Path) -ne $ExpectedFolderName) {
  Write-Warning "A pasta atual nao se chama $ExpectedFolderName. Confira se voce esta no projeto correto antes de continuar."
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js nao encontrado no PATH.'
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw 'npm nao encontrado no PATH.'
}

if (-not (Get-Command firebase -ErrorAction SilentlyContinue)) {
  throw 'Firebase CLI nao encontrado. Instale com: npm install -g firebase-tools'
}

if (-not (Test-Path '.\.env')) {
  if (Test-Path '.\.env.example') {
    Copy-Item '.\.env.example' '.\.env'
    Write-Host '.env criado a partir de .env.example.' -ForegroundColor Yellow
  } else {
    throw '.env e .env.example nao encontrados.'
  }
}

Write-Host '1/3 - Instalando dependencias...' -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -ne 0) { throw 'Falha no npm install.' }

Write-Host '2/3 - Gerando build de producao...' -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Falha no build. Deploy cancelado.' }

if (-not (Test-Path '.\dist\index.html')) {
  throw 'dist\index.html nao encontrado. Deploy cancelado por seguranca.'
}

Write-Host '3/3 - Publicando Firestore, Storage e Hosting no projeto Firebase isolado...' -ForegroundColor Yellow
Write-Host "Projeto fixado por parametro: $ProjectId" -ForegroundColor DarkCyan

$FirebaseCommand = "firebase deploy --only firestore:rules,firestore:indexes,storage,hosting --project $ProjectId --non-interactive"
cmd /c $FirebaseCommand
$FirebaseExitCode = $LASTEXITCODE

if ($FirebaseExitCode -ne 0) {
  throw "Falha real no deploy Firebase (codigo $FirebaseExitCode). Leia as linhas imediatamente acima para identificar se o erro ocorreu em Firestore, Storage ou Hosting."
}

Write-Host ''
Write-Host 'DEPLOY CONCLUIDO COM SUCESSO.' -ForegroundColor Green
Write-Host "Hosting esperado: https://$ProjectId.web.app" -ForegroundColor Green
Write-Host 'Firestore + Storage + Hosting publicados no mesmo projeto isolado.' -ForegroundColor Green
