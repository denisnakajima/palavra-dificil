# Palavra Difícil

Uma palavra rara de 5 letras por dia, no estilo Termo. Depois de acertar (ou de errar as 6 tentativas), o jogo mostra o significado.

Sem dependências: só Node 18 ou mais novo.

## Rodar

```bash
npm start          # http://localhost:3000
npm run dev        # reinicia ao editar arquivos
npm test           # testes com node --test
```

## Como funciona

- A palavra do dia fica só no servidor. O navegador manda as tentativas para `POST /api/check` e recebe as cores de cada letra. A palavra e o significado só voltam quando a partida termina.
- O dia vira à meia-noite de São Paulo, igual para todo mundo. A palavra nº 1 foi 19/10/2026 e a lista roda em ordem, voltando ao começo quando acaba.
- As tentativas do dia e as estatísticas ficam no `localStorage` de cada navegador.

## Configuração (variáveis de ambiente)

| Variável | Padrão | Para quê |
| --- | --- | --- |
| `PORT` | `3000` | Porta do servidor |
| `HOST` | `0.0.0.0` | Endereço de escuta |
| `TZ_NAME` | `America/Sao_Paulo` | Fuso que define a virada do dia |
| `START_DATE` | `2026-10-19` | Data da palavra nº 1 |

## Adicionar palavras

Edite `words.json`. Cada entrada tem:

```json
{ "w": "âmago", "c": "substantivo masculino", "d": "Definição.", "e": "Frase de exemplo." }
```

A palavra precisa ter 5 letras (acentos e cedilha são ignorados na comparação) e não pode repetir. O servidor confere isso ao iniciar e avisa qual entrada está errada.

## Estrutura

```
server.js        servidor HTTP, API e arquivos estáticos
lib/game.js      pontuação, dia, palavra do dia (testado)
words.json       palavras, classes, definições e exemplos
public/          index.html, style.css, app.js
test/            testes
```

## Limitações conhecidas

- Qualquer sequência de 5 letras é aceita como tentativa; não há dicionário de validação.
- O servidor não guarda estado. Quem enviar 6 tentativas de uma vez à API vê a palavra, o que é o mesmo que perder a partida.
