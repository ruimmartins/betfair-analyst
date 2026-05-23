# Instruções para Análise de +EV (Valor Esperado)

O ficheiro `dossier.txt` contém informações de jogos (fixtures, odds, notícias) de várias competições. O teu objetivo é analisar estes dados e detetar **Apostas de Valor (+EV)**.

## O que procuramos:
- O teu critério de decisão deve ser fortemente inclinado para os números e contexto desportivo (peso de 70% na decisão):
  - **Estatísticas Pré-Live (formato compacto no dossier):**
    - `GF:GC` = Golos Marcados : Golos Sofridos (ex: 50:46 significa 50 marcados, 46 sofridos)
    - `CS` = Clean Sheets (ex: CS:9 = 9 jogos sem sofrer golos)
    - `Forma` = Sequência de resultados (W=Win, D=Draw, L=Loss), últimos 20 jogos
    - `H2H: V-E-D|GF:GC` = Head-to-head (ex: 5-3-2 = 5 vitórias, 3 empates, 2 Derrotas, 18:12 = golos totais)
    - `INJ(H/A)` = Jogadores lesionados ou dúvida (lista de nomes)
  - **Contexto da Competição:** Tem em conta o momento na época, necessidade de vitória para manutenção/título/competições europeias. Considera também o tipo de jogo e motivação.
- O impacto das notícias deve ser secundário (peso de 30% a 40% na decisão):
  - Usa as notícias apenas como um fator de confirmação ou de alerta grave (desfalques de jogadores nucleares, treinador novo, crise no balneário). Não bases uma pick exclusivamente numa notícia se os números não a suportarem.
- Jogos onde as odds oferecidas pelos bookmakers não pareçam refletir a realidade das equipas tendo em conta as estatísticas acima.
- Discrepâncias de odds entre bookmakers (ex: a Betfair Exchange e a Pinnacle apresentam diferenças significativas face à Bet365).

## O que deves ignorar:
- Jogos sem dados estatísticos suficientes ou sem odds disponíveis.
- Jogos em que o "valor" provém apenas de um rumor ou notícia fraca, sem o apoio da forma recente/estatísticas.
- Jogos cujas odds refletem o claro favoritismo óbvio, sem valor aparente.

## Como responder:
Responde estritamente com os jogos que encontraste onde acreditas haver +EV.
Para cada jogo, usa o seguinte formato:

🔥 [Competição] - [Equipa Casa] vs [Equipa Fora]
⏰ [Hora do jogo]
💡 Aposta Sugerida: [Mercado e Seleção, ex: Vitória do Casa / Mais de 2.5 Golos]
📊 Melhor Odd Encontrada: [Valor e Bookmaker]
📝 Justificação: [Explicação curta de 2-3 frases focando-se no cruzamento entre as odds desajustadas, estatísticas, contexto e a informação recolhida das notícias.]
---

Se NÃO encontrares valor real em nenhum jogo, responde apenas com: "Sem oportunidades de valor (+EV) evidentes no dossier de hoje."
