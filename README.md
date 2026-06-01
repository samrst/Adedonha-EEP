# 🎯 Adedonha SENAI — Online

Jogo de Adedonha multiplayer em tempo real com estética SENAI.  
Funciona 100% no navegador, sem servidor próprio — hospede no **GitHub Pages** e use o **Firebase** como banco de dados gratuito.

---

## ⚡ Configuração em 5 minutos

### 1. Criar o banco de dados Firebase (gratuito)

1. Acesse **https://console.firebase.google.com**
2. Clique em **"Criar um projeto"** → dê um nome (ex: `adedonha-senai`) → Continuar
3. Desative o Google Analytics (não é necessário) → **Criar projeto**
4. No menu lateral, clique em **Realtime Database**
5. Clique em **"Criar banco de dados"**
6. Escolha a região mais próxima (ex: `us-central1`) → Avançar
7. Selecione **"Iniciar no modo de teste"** → Ativar
8. Copie a URL do banco — formato: `https://SEU-PROJETO-default-rtdb.firebaseio.com`

### 2. Configurar o jogo

Abra o arquivo `game.js` e na linha 20 substitua a URL:

```js
// ANTES:
const FIREBASE_URL = 'https://adedonha-senai-default-rtdb.firebaseio.com';

// DEPOIS (cole a sua URL):
const FIREBASE_URL = 'https://SEU-PROJETO-default-rtdb.firebaseio.com';
```

### 3. Hospedar no GitHub Pages

1. Crie um repositório no GitHub (ex: `adedonha-senai`)
2. Faça upload dos 4 arquivos: `index.html`, `style.css`, `game.js`, `README.md`
3. Vá em **Settings → Pages**
4. Em **Source**: selecione `Deploy from a branch`
5. Escolha branch `main` e pasta `/ (root)` → **Save**
6. Aguarde ~1 min e acesse `https://seu-usuario.github.io/adedonha-senai/`

### 4. Configurar regras do Firebase (para produção)

Após os testes, proteja seu banco:

```json
{
  "rules": {
    "rooms": {
      "$roomId": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```

No Firebase Console: **Realtime Database → Regras** → cole e publique.

---

## 📁 Estrutura de arquivos

```
adedonha-senai/
├── index.html   — estrutura HTML5 semântica
├── style.css    — estilos (responsivo: desktop, tablet 768px, mobile 480px)
├── game.js      — lógica do jogo + integração Firebase
└── README.md    — este arquivo
```

---

## 🎮 Como jogar

### Criar uma sala
1. Acesse o site
2. Digite seu nome → **Criar Sala**
3. Escolha o modo do host: **🎮 Jogar** ou **👁️ Apenas assistir**
4. Configure tempo, rodadas e categorias
5. Compartilhe o **código de 6 letras** com os participantes
6. Clique em **▶ Iniciar Partida**

### Entrar em uma sala
1. Acesse o mesmo site
2. Digite seu nome e o código da sala
3. Clique em **Entrar na Sala**
4. Aguarde o host iniciar

### Durante o jogo
- Preencha respostas com a letra sorteada
- Clique **🛑 STOP!** quando terminar (ou espere o tempo acabar)
- O host valida as respostas: **✓** válido / **✗** inválido
- Resposta única = **10 pts** · Resposta igual a outro = **5 pts**

### Modo espectador (host)
- O host pode escolher **"👁️ Apenas assistir"** no lobby
- Ele não preenche respostas, mas **controla toda a partida**
- Pode ver as métricas de **qualquer jogador** na tela de resultados
- Valida as respostas e avança as rodadas normalmente

---

## 📊 Métricas (exibidas ao final de cada rodada)

| Métrica | Fórmula |
|---|---|
| 🎯 **Eficácia** | `(respostas válidas ÷ total de categorias) × 100%` |
| ⚡ **Eficiência** | `(respostas únicas ÷ respostas válidas) × 100%` |
| 📊 **Produtividade** | Pontuação total obtida na rodada (pts) |

Ao final da partida, é exibido um **ranking separado** para cada métrica (média acumulada de todas as rodadas).

---

## ✨ Funcionalidades

- 🏠 Salas online com código de 6 caracteres
- 👥 Multiplayer real entre navegadores diferentes (via Firebase)
- 👁️ Modo espectador para o host
- ⏱️ Cronômetro configurável (60 / 90 / 120 / 180 s)
- 🔡 Letras sorteadas automaticamente, sem repetição
- 📋 Categorias customizáveis (até 10)
- ✅ Validação manual de respostas pelo host
- 📊 Métricas individuais por rodada + ranking final
- 🏆 Pódio e rankings por Eficácia, Eficiência e Produtividade
- 📱 Totalmente responsivo (desktop, tablet e mobile)

---

## 🎨 Identidade Visual SENAI

| Cor | Hex |
|---|---|
| Azul institucional | `#003087` |
| Vermelho SENAI | `#C8102E` |
| Dourado (destaque) | `#E8A020` |
| Verde (sucesso) | `#1a8a4a` |

Tipografia: **Barlow Condensed** (display) · **Barlow** (corpo)

---

## 🛠️ Tecnologias

- HTML5 semântico
- CSS3 com custom properties, Grid e Flexbox
- JavaScript ES2020+ (async/await, optional chaining)
- Firebase Realtime Database (REST API — sem SDK)
- Google Fonts: Barlow + Barlow Condensed

---

Desenvolvido com ❤️ para o SENAI.
