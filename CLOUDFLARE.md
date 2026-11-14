# Cloudflare Pages

ShiftFlow Basic se objavljuje kao statički Next.js sajt. Supabase ostaje zaseban backend.

## Povezivanje GitHub repozitorijuma

U Cloudflare kontrolnoj tabli otvoriti Workers & Pages, napraviti Pages projekat i povezati GitHub repozitorijum. Izabrati produkcionu granu `main` i sledeća podešavanja:

| Podešavanje | Vrednost |
| --- | --- |
| Framework preset | Next.js (Static HTML Export) |
| Root directory | koren repozitorijuma |
| Build command | `pnpm build` |
| Build output directory | `out` |
| Node.js | `24.22.1` (fajl `.node-version`) |
| `PNPM_VERSION` | `11.25.0` |

U build environment dodati `NEXT_PUBLIC_SUPABASE_URL` i `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` iz lokalnog `.env.local`. To su javne klijentske vrednosti koje se ugrađuju tokom builda. Administrativni Supabase ključ se ne koristi. `.env.local` nije deo Git repozitorijuma.

Svaki push na `main` pokreće novu produkcionu verziju. Cloudflare dodeljuje besplatnu adresu projekta na domenu `pages.dev`.

## Supabase Auth

Po zahtevu vlasnika projekta, Supabase Auth Site URL ostaje `http://localhost:3000`; ovaj postupak ne menja dozvoljena odredišta prijave. Email potvrde i reset lozinke zato i dalje mogu voditi na lokalnu adresu. Ako ti tokovi treba da rade direktno na produkcionom domenu, vlasnik mora zasebno odobriti promenu Auth podešavanja.

## Provera pre objavljivanja

`pnpm test`, `pnpm exec tsc --noEmit --incremental false` i `pnpm build`. Proveriti prijavu, učitavanje objekta i privatni link objavljenog rasporeda na dodeljenoj Cloudflare adresi.
