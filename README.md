# 🎯 Adedonha SENAI — Online

Jogo de Adedonha multiplayer em tempo real com estética SENAI.  
Funciona 100% no navegador, sem back-end — hospede direto no **GitHub Pages**.

---

## ✨ Funcionalidades

- 🏠 **Salas online** com código de 6 caracteres para compartilhar
- 👥 **Multiplayer em tempo real** via storage compartilhado (Claude.ai)
- 👁️ **Modo espectador para o host** — assiste sem jogar, controla a partida
- ⏱️ Cronômetro configurável (60 / 90 / 120 / 180 s)
- 🔡 Letras sorteadas automaticamente (sem repetição)
- 📋 Categorias customizáveis (padrão + personalizadas)
- ✅ Validação de respostas pelo host (✓ válido / ✗ inválido)
- 📊 **Métricas por rodada:** Eficácia · Eficiência · Produtividade
- 🏆 **Ranking final** com pódio + rankings individuais por métrica
- 📱 **Totalmente responsivo** — desktop, tablet e mobile

---

## 📁 Estrutura de arquivos

```
adedonha-senai/
├── index.html   — estrutura HTML5 da aplicação
├── style.css    — estilos (responsivo, breakpoints 768 e 480px)
├── game.js      — lógica do jogo (multiplayer, métricas, ranking)
└── README.md    — este arquivo
```

---

## 🚀 Como hospedar no GitHub Pages

1. Crie um repositório no GitHub (ex: `adedonha-senai`)
2. Faça upload dos 3 arquivos: `index.html`, `style.css`, `game.js`
3. Vá em **Settings → Pages**
4. Em **Source**, selecione `Deploy from a branch`
5. Escolha a branch `main` e a pasta `/ (root)`
6. Clique em **Save**
7. Aguarde ~1 minuto e acesse `https://seu-usuario.github.io/adedonha-senai/`

---

## 🎮 Como jogar

### Criar uma sala
1. Acesse o site
2. Digite seu nome e clique em **Criar Sala**
3. Escolha o **modo do host**: 🎮 Jogar ou 👁️ Apenas assistir
4. Configure tempo, rodadas e categorias
5. Compartilhe o código com os participantes
6. Clique em **Iniciar Partida**

### Entrar em uma sala
1. Acesse o site
2. Digite seu nome e o código da sala
3. Clique em **Entrar na Sala**
4. Aguarde o host iniciar

### Durante o jogo
- Preencha respostas começando com a letra sorteada
- Clique **🛑 STOP!** quando terminar
- O host valida as respostas (✓ / ✗)
- Respostas únicas valem **10 pts**, repetidas valem **5 pts**

### Modo espectador (host)
- O host pode escolher "👁️ Apenas assistir" no lobby
- Ele **não participa** das rodadas, mas controla o andamento
- Pode visualizar as métricas de **qualquer jogador** na tela de resultados
- Ainda valida as respostas e avança as rodadas

---

## 📊 Métricas

| Métrica | Fórmula |
|---|---|
| **Eficácia** | `(respostas válidas / total de categorias) × 100%` |
| **Eficiência** | `(respostas únicas / respostas válidas) × 100%` |
| **Produtividade** | Pontuação total obtida na rodada |

---

## 🛠️ Tecnologias

- HTML5 semântico
- CSS3 com custom properties e Grid/Flexbox
- JavaScript ES2020+ (async/await, optional chaining)
- Google Fonts: Barlow + Barlow Condensed
- Storage compartilhado (Claude.ai `window.storage`)

> **Nota:** O multiplayer em tempo real depende do `window.storage` disponível no Claude.ai.  
> Para hospedar fora do Claude.ai, substitua as funções `stGet`/`stSet`/`stRead` em `game.js`  
> por uma solução como Firebase Realtime Database, Supabase ou similar.

---

## 🎨 Identidade visual

Segue a paleta oficial SENAI:

| Cor | Hex |
|---|---|
| Azul institucional | `#003087` |
| Vermelho SENAI | `#C8102E` |
| Dourado (destaque) | `#E8A020` |
| Verde (sucesso) | `#1a8a4a` |

Tipografia: **Barlow Condensed** (display) · **Barlow** (corpo)

---

Desenvolvido com ❤️ para o SENAI.
