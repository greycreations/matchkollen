# Matchkollen

Matchkollen hjälper ett lag att planera matcher, välja matchtrupp, registrera mål per period och spelare samt följa statistik för fotboll och innebandy. Uppgifter lagras i en SQL-databas och matchhistorik finns kvar när lag eller spelare tas bort från de aktiva listorna.

## Docker Compose

Kräver Docker Engine med Compose v2.

1. Spara `docker-compose.yml` i en valfri mapp på servern. Compose hämtar byggkontexten och `Dockerfile` från rotmappen i GitHub-repot.
2. Starta appen från mappen:

   ```sh
   docker compose up --build -d
   ```

3. Öppna `http://localhost:8060`.
4. Vid första starten visas konfigurationen där du skapar administratörskontot. Lösenordet ska ha minst 12 tecken.
5. Logga in som admin och öppna **Användare** för att skapa konton och välja behörigheter för att lägga till, ändra eller ta bort uppgifter.

Compose skapar den beständiga volymen `matchkollen_data`. Matchdata, konton och sessioner ligger i volymen och finns kvar när containern startas om eller byggs om. Migreringar tillämpas automatiskt vid containerstart. Appen nås på port 8060. Ändra värdet på vänster sida i `8060:8787` om du vill använda en annan port. Om du placerar en reverse proxy framför appen ska proxyn vidarebefordra `Host`, `X-Forwarded-Host` och `X-Forwarded-Proto`.

Appen har inget öppet självregistreringsflöde. Admin skapar konton och kan stänga av dem. Behörigheter kontrolleras på servern. Administratören har alltid full åtkomst.

## Funktioner

- Sporter, åldersgrupper, lag och spelartrupper
- Redigera eller arkivera lag och spelare utan att förlora matchhistorik
- Planera matcher med datum, tid, plats, motståndare och två eller tre perioder
- Planera cuper och sammandrag med flera matcher kopplade till samma grupp
- Välja vilka spelare som deltar i varje match
- Registrera och redigera mål med period, lag och målskytt
- Registrera röda, gula och gröna kort per spelare och period, med kortstatistik per sport
- Filtrera statistik per sport, lag, cup/sammandrag och match
- Statistik med resultat, mål, skytteliga, närvaro och lagöversikt
- Användarkonton med separata behörigheter för sporter/lag, spelare, matcher och matchhändelser

## Lokal utveckling

Kräver Node.js 22.13 eller senare.

```sh
npm ci
npm run build
```

Initiera en helt ny lokal databas genom att tillämpa migreringarna i ordning:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_blue_shadow_king.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_wet_gambit.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0002_wandering_patch.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0003_curvy_loa.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0004_cup_competitions.sql
```

Starta sedan förhandsvisningen med `npm run dev`. Lokal databasdata sparas i `.wrangler/state`.
