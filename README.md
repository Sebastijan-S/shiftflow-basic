# ShiftFlow Basic

Next.js, TypeScript, Supabase PostgreSQL/Auth/RLS i postojeći Tailwind/UI sistem. Premium funkcije nisu uključene.

## Pokretanje

Node.js 22+ i pnpm. Kopirati .env.example u .env.local i uneti NEXT_PUBLIC_SUPABASE_URL i NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. Javne vrednosti se ugrađuju tokom statičkog builda; tajni administrativni ključ nije deo klijenta.

- pnpm dev — lokalna aplikacija na http://127.0.0.1:3000
- pnpm exec tsc --noEmit --incremental false — TypeScript
- pnpm test — generator, istorija, konkurentno čuvanje i PostgreSQL integracija
- pnpm build — produkcioni statički izlaz u out/

scripts/next.mjs normalizuje Windows putanje. Zadržan je statički export; Supabase je zaseban backend.

Za objavljivanje preko GitHub-a i Cloudflare Pages pogledati [CLOUDFLARE.md](CLOUDFLARE.md).

## Urađeno za Basic

- Izolovan demo sa 10 zaposlenih, 42 smene i 336 sati; nova firma počinje prazna.
- Prilagođene pozicije, više pozicija po zaposlenom, deaktiviranje, cilj sati i opcioni lični maksimum.
- Dodavanje smena, boja, vremena i dana upotrebe; dodele čuvaju svoja vremena i mogu se pojedinačno menjati.
- Nedeljna, datumska i delimična dostupnost, odobrena odsustva, nedostupnost i želje za slobodnim danom. Zamena zaposlenog beleži prethodnu i novu osobu.
- Osnovne potrebe po danu/smeni/poziciji i izuzeci za izabranu nedelju/datume.
- Deterministički generator sa 36 prolaza, jedinstvenim ID-jevima i očuvanim zaključavanjima. Ne garantuje optimalno rešenje. Prioritet je broj popunjenih mesta, zatim konflikti i raspodela sati/preferencije.
- Brza izmena dodele i vremena, dupliranje jedne dodele, kopiranje nedelje, drag-and-drop, nedeljni/dnevni/list prikaz.
- Lokalni format 2 sa migracijom starog stanja; korisnik i firma imaju zaseban keš. Lokalna Undo istorija se ne šalje u cloud i ograničava se pri pisanju.
- Serijski autosave, trajni red nepotvrđenih upisa, idempotentni operation ID i tačan status potvrde. Nezavisne izmene se spajaju; poslednja prihvaćena izmena istog polja ostaje uz serverski audit. Brisanje naspram konkurentne izmene se ne prepisuje prećutno. Undo/Redo odbija prepisivanje novije promene istog polja.
- Poslednja objavljena verzija ostaje dostupna dok se priprema novi nacrt. Validne izmene objavljene nedelje osvežavaju njenu projekciju.
- Privatni tokeni važe 60 dana, mogu se rotirati i opozvati. Otvoren javni prikaz proverava izmene na 30 sekundi i pri fokusu.
- Poseban PNG/PDF prikaz tima bez internih napomena, odsustava, dostupnosti i ciljnog fonda. PDF koristi dijalog štampe pregledača.
- Vlasnik upravlja pristupom i nazivom firme; menadžer zaposlenima, pozicijama, pravilima i rasporedom. Korisnik može pripadati više objekata. Pozivni link je vezan za potvrđenu email adresu i važi 7 dana; email se ne šalje automatski.
- Vođena priprema objekta i eksplicitan početak 21 dana probe. Cena i limit zaposlenih nisu hardkodovani. Plaćeni nastavak zahteva pouzdanu administrativnu potvrdu prema dogovoru o pilotu.
- Serverska obaveštenja i korisničko stanje pročitano.

## Supabase

Povezan projekat: https://enwllpwemymmeyycbwie.supabase.co. Migracije su primenjene kroz Supabase MCP. Baza ima 21 tabelu sa RLS-om. Privilegovana implementacija je u private šemi; javni RPC-jevi su SECURITY INVOKER wrapperi sa tačno određenim dozvolama. Direktno pisanje tabela iz klijenta je zabranjeno. save_workspace_v2 atomski ažurira normalizovane podatke, dokument, audit i potvrdu operacije. Svaki upis proverava aktuelno članstvo.

Za praznu dodatnu bazu primeniti SQL fajlove iz supabase/migrations redom. Ne primenjivati ih ponovo na već podešen projekat. MCP vodi sopstvene serverom generisane verzije migracija; pre eventualnog prelaska na CLI db push uskladiti istoriju sa listom primenjenih migracija.

U Supabase Auth podesiti Site URL i dozvoljene redirect adrese za produkcioni domen i lokalni razvoj. Email potvrda se poštuje. Vlasnik se registruje u aplikaciji; Supabase platform nalog nije isti nalog kao korisnik ShiftFlow-a.

Hosting publika ostaje kao na postojećem Site-u. Za linkove zaposlenih bez prijave i spoljne menadžere potrebno je da sama stranica aplikacije bude dostupna toj publici; RLS i privatni tokeni zasebno štite poslovne podatke.

## Provere i preostale pilot odluke

Automatski testovi obuhvataju četiri izolovana objekta, zabrane pristupa, atomske upise i ponavljanje istog zahteva, datumsko odsustvo, noćni rad, duple ID-jeve uz zaključavanje, istorijska vremena/objave, poziv postojećem korisniku, prava menadžera, privatnost linka i sporo/neuspešno čuvanje. Auth se u PostgreSQL testovima simulira; stvarna registracija, email potvrda i svakodnevni rad više korisnika proveravaju se na stvarnim nalozima.

Za pilot ostaju merenje toka ispod pet minuta u četiri stvarna objekta, doterivanje inline/cascading menija, mobilnog prevlačenja i grupnih korekcija prema posmatranju, pregled zastarelih offline promena istog polja pre njihovog ponovnog slanja, naprednija raspodela vikenda kroz više nedelja i konačna pravila naplate/čuvanja podataka. Automatska naplata nije uvedena. Promene računanja vremena (DST) za planirane sate nisu zasebno obrađene; trajanje se računa po lokalnim časovima.
