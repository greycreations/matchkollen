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
5. Logga in som admin och öppna **Användare** för att skapa konton, välja rollen **Tränare** eller **Förälder** och markera vilka lag kontot får tillgång till.

Compose skapar den beständiga volymen `matchkollen_data`. Matchdata, konton och sessioner ligger i volymen och finns kvar när containern startas om eller byggs om. Migreringar tillämpas automatiskt vid containerstart. Appen nås på port 8060. Ändra värdet på vänster sida i `8060:8787` om du vill använda en annan port. Om du placerar en reverse proxy framför appen ska proxyn vidarebefordra `Host`, `X-Forwarded-Host` och `X-Forwarded-Proto`.

Appen har inget öppet självregistreringsflöde. Admin skapar konton och kan stänga av dem. Behörigheter kontrolleras på servern. Administratören har alltid full åtkomst.

## Uppdatera en befintlig Docker-installation

Kör från mappen med din `docker-compose.yml`:

```sh
docker compose build --no-cache matchkollen
docker compose up -d matchkollen
```

Bygget hämtar senaste koden från `main`. Databasmigreringarna körs automatiskt vid start och volymen `matchkollen_data` behålls.

Efter uppdateringen till roller och lagtillgång behöver admin öppna **Användare** och tilldela befintliga användarkonton roll och lag. Tidigare konton med rollen `user` blir **Förälder** utan tilldelade lag. Konton, lösenord och matchhistorik behålls; admin påverkas inte. Ändring av ett kontos roll eller lag avslutar dess befintliga sessioner så att personen får logga in igen.

## Roller, lag och sporter

- **Admin** ser och hanterar alla sporter, lag och konton.
- **Tränare** kan registrera och hantera spelare, matcher, cuper, mål och kort för sina tilldelade lag. Sporter och själva lagregistret hanteras av admin.
- **Förälder** kan endast visa tilldelade lags trupper, matcher, resultat och statistik.
- Ett konto utan tilldelade lag ser ingen lagdata. Tilldelning kan även omfatta arkiverade lag för åtkomst till historik.

Under **Användare** visas separata tabeller för tränare, föräldrar och administratörer, sorterade efter namn A–Ö. **Stäng av konto** avslutar inloggningar tillfälligt och kontot kan aktiveras igen. **Ta bort konto** raderar kontot, dess lagtillgång och sessioner permanent efter bekräftelse. Lag, spelare och matchhistorik påverkas inte. Bara admin får ta bort konton, och administratörskonton skyddas från borttagning.

Startsidan visar planerade matcher i datumordning med tydlig sportmärkning. Sportväljaren filtrerar lag, spelare, matcher, cuper och statistik i hela appen. Admins kontohantering visar alltid alla lag, grupperade efter sport.

Med **Färgtema** i sidhuvudet kan du välja **Ljust**, **Mörkt** eller **System**. System följer enhetens färgtema och är standard. Valet sparas i den aktuella webbläsaren och gäller även inloggningssidan.

Om en match startats av misstag kan admin eller en tränare för laget välja **Tillbaka till planerad** under **Pågående matcher** på fliken **Matcher**. Mål, kort och matchtrupp behålls, och matchen kan startas igen senare.

## Kortval

Vid skapande väljer du gula, röda och gröna kort var för sig. Fristående matcher har egna inställningar. För en cup eller ett sammandrag gäller ett gemensamt val, även för matcher som läggs till senare. Endast aktiverade korttyper visas som registreringsknappar i matchvyn och tillåts av servern.

Välj **Redigera match** på fliken **Matcher** (även under **Historik**) eller inställningsknappen i matchvyn för att ändra lag, lagnamn, motståndare, datum och tid, plats, periodantal, cup/sammandrag, status och kortval. Tränare kan redigera sina tilldelade lag; bara admin kan ändra cupens gemensamma kortval. Redan registrerade kort finns kvar i historik och statistik. Befintliga matcher och cuper har alla tre korttyper aktiverade efter uppdateringen.

Lagbyte tillåts bara när matchen saknar matchtrupp, mål och kort. Antalet perioder kan inte minskas om det finns händelser i en senare period. Dessa kontroller skyddar matchhistoriken vid redigering.

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
- Gemensam startsida med sportväljare och planerade matcher
- Tränar- och föräldrakonton med tillgång till valda lag och serverkontrollerade behörigheter
- Individuellt kortval per match eller gemensamt för cup/sammandrag

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
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0005_roles_teams_cards.sql
```

Starta sedan förhandsvisningen med `npm run dev`. Lokal databasdata sparas i `.wrangler/state`.

Verifiera med `npm run lint`, `npx tsc --noEmit`, `npm run build` och `npm run test:access`. Behörighetstesterna kör de riktiga API-funktionerna och samtliga SQL-migreringar mot en isolerad SQLite-databas och kräver Node.js 22.13 eller senare.
## Användarhjälp

Start-fliken har ett öppningsbart hjälpavsnitt som beskriver konton, lagtillhörighet, spelare, matchplanering, perioder, avslut, historik, statistik och temaval. Tränare kan kopplas till flera lag i flera sporter under Användare och ser sina tränarlag på startsidan. Vid periodpaus gör man uppehåll i registreringen; appen har ingen separat pausstatus eller matchklocka.
