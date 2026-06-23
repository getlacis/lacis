# Lacis — Roadmap durcissement v0.4 → v1.0

> Document de travail à destination de Claude Code.
> Contexte : framework backend TS, file-based routing, multi-runtime (node/bun/vercel/netlify, + cloudflare en PR),
> zéro dépendance runtime, OpenAPI natif. Deux PR en cours : **wrangler** (adaptateur Cloudflare) et **openapi**
> (`responses`, `operationId`, `servers`, hoisting description/example).
>
> **Décision produit** : on ne tag PAS 1.0 tout de suite. On fait une **0.5 de durcissement** d'abord, parce que
> plusieurs changements ci-dessous sont *breaking après 1.0* (typage réponses, locals, `req.platform`, signatures
> middleware). Le 1.0 est un contrat semver : il doit être figé proprement, pas juste « riche en features ».

---

## Vision à figer (à mettre dans le README)

> « file-based, multi-runtime, zéro dépendance — et un contrat OpenAPI **vrai par construction** :
> validé à l'entrée, typé à la sortie, générable en client. »

Tout le chantier type-safety ci-dessous sert cette phrase. Le `responses` de la PR openapi ne doit pas servir
*uniquement* à alimenter la doc : il doit aussi **typer le handler** (une seule source de vérité).

---

## Phase 0.5 — Durcissement (bloquant pour 1.0)

### 0.5.1 — Corriger le mensonge `loadBalancing` / `createLoadBalancer`
**Problème** : `examples/node/server.ts` passe `cluster: { …, loadBalancing: "fastest-response" }`, mais :
- `ServerConfig.cluster` ne contient que `{ enabled, workers }` → l'option est **silencieusement ignorée**.
- La distribution des connexions est faite par l'OS via `SCHED_RR` (round-robin noyau) dans `node.ts`.
- `createLoadBalancer` ne *route* rien : il fork/supervise les workers et **collecte** des stats (`load`,
  `memoryUsage`) worker→primary qui ne sont **jamais lues pour router**. Le primary n'accepte pas les sockets
  (SCHED_RR), donc un vrai LB applicatif est impossible sans casser SCHED_RR (plus lent, plus fragile).

**Ne PAS implémenter** un vrai load-balancing applicatif. Le round-robin noyau est le bon défaut.

**À faire** :
- [ ] Retirer `loadBalancing` de `examples/node/server.ts`.
- [ ] Renommer `createLoadBalancer` → `createWorkerSupervisor` (ou `clusterManager`) : le nom actuel ment sur
      ce que fait le code. Mettre à jour `src/utils/loadBalancer.ts`, `src/types/loadBalancer.ts`, les imports
      (`node.ts`), et `tests/utils/loadBalancer.test.ts`.
- [ ] Trancher le sort des stats worker→primary :
  - **Option A (recommandée)** : les exposer dans `/health` (agréger par worker). Donne une vraie valeur.
  - **Option B** : supprimer tout le reporting `reportStats`/message `stats` → moins de code, moins de surface.
- [ ] Documenter noir sur blanc : « distribution des requêtes = round-robin OS (SCHED_RR), pas d'algo applicatif ».

### 0.5.2 — `req.form` : supporter `application/x-www-form-urlencoded`
**Problème** : `withRequestMethods.form()` ne gère que `multipart/form-data`. C'est le cas le plus rare ;
le POST de formulaire HTML standard est `urlencoded` et n'est pas parsé.

**À faire** :
- [ ] Dans `src/utils/adapter-base.ts`, brancher `form()` sur le `content-type` :
  - `multipart/form-data` → parsing multipart existant (inchangé).
  - `application/x-www-form-urlencoded` → `Object.fromEntries(new URLSearchParams(body.toString()))`.
  - autre → rejeter avec message clair.
- [ ] Tests dans `tests/utils/adapter-base.test.ts` : champ simple, champs multiples, valeurs percent-encodées.

### 0.5.3 — `MAX_BODY_SIZE` configurable + consolidation
**Problème** : la constante est **triplée** : `MAX_BODY_SIZE` dans `adapter-base.ts`, `MAX_BODY_SIZE` dans
`bun.ts`, et `WEB_MAX_BODY_SIZE` dans `web-adapter-base.ts`. Rendre la limite configurable est donc aussi un
travail de consolidation.

**À faire** :
- [ ] Une seule constante de défaut partagée (idéalement dans `web-adapter-base` ou un module `constants`),
      consommée partout. Si `bun.ts` est refactoré sur la base Web (cf. 0.5.7), sa constante locale disparaît.
- [ ] Ajouter `maxBodySize?: number` à `ServerConfig` (défaut 10 Mo).
- [ ] Le propager jusqu'à `nodeBody` (shim node/serverless) et aux checks de la base Web.
- [ ] (Optionnel, plus tard) override par route via `defineHandler({ maxBodySize })`.
- [ ] Tests : limite custom respectée, erreur 413 conservée.

### 0.5.4 — Polish OSS / ESM
**À faire** :
- [ ] Nettoyer les commentaires français résiduels :
  - `src/types/index.ts` : `// Options existantes`, `// Dans src/types/index.ts`.
  - `src/sse/client.ts` : `// Pour les connexions avec URL…`.
  - `tsconfig.example.json` : commentaires FR.
- [ ] (Note dette technique, pas bloquant) `stream`/`ndjson` existe désormais en **3 implémentations** : la
      write-loop de `withResponseMethods` (node), l'override `ReadableStream` de `WebApiResponse` (web), la
      version bufferisée de `applyResponseMethods` (serverless). Cohérent mais à surveiller — candidat à
      factorisation si la divergence reste faible. (La distinction live/bufferisé est documentée en 1.0.3.)

### 0.5.5 — Réponses typées / enforced (le move à plus fort levier)
**Principe** : opt-in, non-breaking. Le typage strict ne s'active **que si** `responses` est déclaré dans
`defineHandler`. Sinon `res` reste le `Response` actuel (lâche). On exploite le pattern `res.status(code).json(...)` :
`status(code)` retourne un "sink" dont `.json` n'accepte que le schéma de ce code. Une seule source de vérité :
`responses` type le handler ET alimente l'OpenAPI.

**Esquisse de types** (à affiner dans `src/core/defineHandler.ts`) :
```ts
type ResponsesMap = Record<number, StandardSchema>
type InferOut<T extends StandardSchema> = NonNullable<T["~standard"]["types"]>["output"]

type Chainable = Pick<Response, "setHeader" | "cookies">
type Sink<T> = Chainable & { json(data: T): void; send(data: T): void; end(): void }

type TypedResponse<R extends ResponsesMap> = Omit<Response, "status" | "json"> & {
  status<S extends keyof R & number>(code: S): Sink<InferOut<R[S]>>
  json(data: InferOut<R[keyof R & number]>): void
}

// handler:
handler: (
  req: ValidatedRequest<TParams, TQuery, TBody>,
  res: TResponses extends ResponsesMap ? TypedResponse<TResponses> : Response
) => void | Promise<void>
```

**À faire** :
- [ ] Construire ce typage **sur** la PR openapi `responses` (ne pas la merger juste pour la doc).
- [ ] Trappe d'échappement obligatoire : garder un accès au `res` brut (ex. `res.raw.json(x as any)`) pour
      le streaming / cas tordus, sinon on se bat contre TS.
- [ ] Validation runtime **en dev seulement** (`if (isDev)`) : vérifier que le body renvoyé respecte le schéma
      du status. Les types n'attrapent pas un `any` venu de la DB. **Zéro validation en prod** (perf).
- [ ] Tests : `res.status(404).json({ id: 1 })` doit erreur-typer si le 404 attend `{ error: string }` ;
      runtime dev rejette un body non conforme ; prod ne valide pas.

### 0.5.6 — `req.locals` typé (v1 : déclaration globale)
**Limite assumée** : l'inférence end-to-end depuis les `+middleware` est **impossible** (middleware file-based =
invisible au système de types ; aucun point où le type compose avec le handler). On fait donc le niveau global
maintenant ; le niveau par-route viendra avec le `use:` inline (voir 1.0.1).

**À faire (déclaration merging, façon `@types/express`)** :
- [ ] Exposer dans `lacis` :
```ts
export interface Locals {}
interface Request { locals: Locals }
```
- [ ] Initialiser `req.locals = {}` dans `adapter-base` (et chemins bun/node/serverless).
- [ ] L'utilisateur enrichit :
```ts
declare module 'lacis' {
  interface Locals { user: { id: string; role: string } }
}
```
- [ ] Migrer les `(req as any).headers[...]` des tests/exemples vers `req.locals` quand c'est de la donnée
      applicative (l'injection d'en-tête reste légitime, mais le passage de contexte doit passer par `locals`).
- [ ] Documenter la limite : `locals` est **global** (toutes les routes "voient" `user` comme défini, même
      sans auth). Imprécis mais compatible file-based, suffisant pour ~90 % des cas.

> **Note** : `Locals` (0.5.6) et `PlatformContext` (0.5.9) sont le **même pattern** (déclaration merging + init
> `= {}` dans les adaptateurs). À implémenter ensemble : même endroit dans le code, même paragraphe de doc.

### 0.5.7 — Adaptateur Cloudflare Workers (PR wrangler)
**Pourquoi en 0.5** : `cloudflare.ts` est **déjà écrit** dans la PR wrangler, et il est le **support** de 0.5.8
(parité/405) et 0.5.9 (`req.platform`). Il doit donc précéder ces deux tâches. Pour le pitch « multi-platform »,
CF est aussi le runtime edge le plus demandé.

**Contexte archi (PR wrangler)** : la PR introduit `web-adapter-base.ts` qui factorise le **modèle Response Web**
(`WebApiResponseBase` + `WebApiResponse` via `withResponseMethods`, `buildWebApiResponse`, `WEB_MAX_BODY_SIZE`).
L'adaptateur CF s'appuie dessus — **pas** sur le shim Node (`IncomingMessage`/`ServerResponse`) comme
vercel/netlify. La boucle `fetch()` (middlewares → findRoute → handler → buildResponse) reste **par adaptateur**.

**À faire** :
- [ ] Finaliser `src/adapters/cloudflare.ts` sur `web-adapter-base` (sous-classe Response qui set
      **`_adapterName = 'cloudflare'`** — sinon le message d'erreur SSE dit `[lacis/unknown]`).
- [ ] **Refactorer `bun.ts` pour consommer `web-adapter-base`** et supprimer ses `_BunResponseBase` dupliqué
      (garder `BunResponse` mais étendre la base partagée, setter `_adapterName = 'bun'`). *(Déjà fait dans la
      PR — vérifier que `tests/adapters/bun.test.ts` passe, notamment le test du message `[lacis/bun]`.)*
- [ ] **Factoriser aussi la partie Request** (suit, pas bloquant) : Bun et CF wrappent tous deux un `Request`
      Web → un `WebApiRequestBase` pour la partie commune (`body()` via `arrayBuffer()` + check `WEB_MAX_BODY_SIZE`).
      Garder spécifiques les optimisations (`json()` natif Bun, `connection.remoteAddress` par runtime).
- [ ] Câbler dans `src/adapters/index.ts` (`getAdapter`) et le type `platform`.
- [ ] Adapter `cli/build.ts` + `cli/dev.ts` (détection `wrangler.toml`).
- [ ] Compléter `tests/adapters/cloudflare.test.ts` (déjà commencé) + **un test streaming live** (SSE renvoyant
      un `ReadableStream` non bufferisé) — c'est la propriété qui distingue CF de vercel/netlify, elle régresse
      silencieusement si on « harmonise » CF avec les autres serverless. Réutiliser le `readStream()` du test Bun.
- [ ] **Documenter les divergences assumées** (voir 1.0.3).

### 0.5.8 — Conformité 405 + parité des adaptateurs Web
**Constats en revue de la PR wrangler (Bun + Cloudflare partagent `web-adapter-base`)** :
- **`405` sans en-tête `Allow`** : `findRoute` renvoie `allowedMethods` sur un 405, mais **aucun adaptateur**
  ne s'en sert (préexistant, pas une régression). HTTP impose `Allow` sur un `405 Method Not Allowed`. Le chemin
  est justement touché par la PR → bon moment pour corriger, **de façon transverse** (node/bun/vercel/netlify/cf).
- **Incohérence de style** : Bun teste `"error" in route`, Cloudflare teste `isRouteError(route)`. Équivalent
  fonctionnellement (même forme de `RouteError`), mais à **uniformiser sur `isRouteError` partout**.
- **`defaultHeaders` non appliqué sur Cloudflare** : Bun fait la boucle `res.setHeader(...)` en tête de `fetch`,
  CF non. À trancher : soit l'ajouter (parité), soit **documenter** que `defaultHeaders` est node/bun-only.

**À faire** :
- [ ] Émettre l'en-tête `Allow: <méthodes>` sur tout 405, dans tous les adaptateurs (via `allowedMethods`).
- [ ] Remplacer `"error" in route` par `isRouteError(route)` dans `bun.ts` (et vérifier les autres).
- [ ] Décider du sort de `defaultHeaders` sur CF (ajout ou doc).

**Mineur CF (non bloquant, noté pour mémoire)** :
- `connection.remoteAddress` est `''` ; l'IP réelle est dans `req.headers['cf-connecting-ip']` (câblable
  puisque `cf` est déjà capturé).

### 0.5.9 — `req.platform` typé (env/ctx/cf) via déclaration merging
**Contrainte** : exposer `env`/`ctx`/`cf` **uniquement là où ils existent (CF)**, sans forker le type `Request`
par adaptateur (un seul `Request`/`Response` générique partout). Résolu par **déclaration merging**, même
mécanisme que `Locals` (0.5.6) — une seule idée à comprendre dans le framework.

**Choix arrêtés** : accès **regroupé** sous `req.platform` (tout le plateforme-spécifique vit là, ne salit pas
la racine de `Request`). Interface `PlatformContext` **vide par défaut** → sur un projet node, `req.platform`
n'expose rien (pas de `env` fantôme). C'est le `env.d.ts` du scaffold CF qui injecte la forme.

**À faire (côté framework `lacis`)** :
- [ ] Exposer :
```ts
export interface PlatformContext {}
interface Request { platform: PlatformContext }
```
- [ ] L'adaptateur CF peuple `req.platform = { env, ctx, cf }` ; les autres adaptateurs laissent `{}` (ou ne le
      touchent pas). `ctx` (`ExecutionContext`) et `cf` (`IncomingRequestCfProperties`) sont des types **runtime**
      (de `@cloudflare/workers-types`), donc fournis/référencés par Lacis, pas par l'utilisateur.

**À faire (côté `create-lacis`, template CF uniquement)** :
- [ ] Générer un `env.d.ts` qui augmente :
```ts
declare module 'lacis' {
  interface PlatformContext {
    env: Env                       // Env augmenté par le même .d.ts (bindings KV/D1/R2/secrets)
    ctx: ExecutionContext
    cf: IncomingRequestCfProperties
  }
}
```
- [ ] Vérifier que l'utilisateur accède en `req.platform.env` **sans `as any`** (le `.d.ts` se branche sur un
      point typé, au lieu de flotter à côté d'un cast).

**Engagement semver** : le **nom** (`PlatformContext`, `req.platform`) et le fait que ce soit augmentable doivent
être figés **avant 1.0**. Le contenu, lui, reste libre (injecté par scaffold).

---

## Phase 1.0 — Complétude & gel

### 1.0.1 — Middleware par route dans `defineHandler` (`use: [...]`)
**Pourquoi** (ce n'est PAS « +middleware est nul », c'est un granulaire que le file-based ne peut pas faire) :
1. **Scoping par méthode impossible** : `+middleware` est scopé par *chemin*, jamais par *verbe*. Ex. `/users`
   avec `GET` public + `POST` auth → impossible de viser seulement POST sans `if (req.method)` moche ou arbo
   artificielle.
2. **Co-localisation** : lire `use: [rateLimit, auth]` au-dessus du handler, là où on lit la route.
3. **Inférence des types** : un middleware inline permet à TS d'inférer `req.locals.user` **pour ce handler**
   (= locals par-route, le complément de 0.5.6).

**À faire** :
- [ ] Ajouter `use?: MiddlewareCallback[]` à `DefineHandlerConfig`.
- [ ] Exécuter `use` après les `+middleware` du chemin, avant le handler ; respecter le `return false` (stop).
- [ ] **Décider maintenant du sort de l'inférence des locals** : si on livre `use:` en 1.0 *sans* l'inférence
      (runtime seulement) et qu'on l'ajoute après, **la signature de `MiddlewareCallback` change** (un middleware
      doit pouvoir déclarer ce qu'il ajoute à `locals`) → **breaking**. Donc soit l'inférence est dans le 1.0,
      soit la signature de `MiddlewareCallback` est conçue dès maintenant pour l'accueillir sans casse.
- [ ] Tests : ordre d'exécution, `return false` stoppe, scoping par méthode effectif.
- [ ] Garder `+middleware` / `+middleware.global` pour le cross-cutting par chemin (CORS, logging, auth de
      section). Les deux coexistent comme cascade/exact aujourd'hui.

### 1.0.2 — Doc OpenAPI → client typé (zéro code maison)
**Décision** : on n'écrit **pas** de codegen. `openapi-generator-cli` / `openapi-fetch` / `orval` font mieux,
en multi-langage, et c'est mûr. En écrire un trahirait l'ADN zéro-dep.

**À faire** :
- [ ] Un paragraphe de doc « générer un client typé depuis ton `/openapi.json` avec `openapi-fetch` », avec un
      exemple qui marche. Bénéfice perçu (« API typée bout en bout ») sans une ligne à maintenir.

### 1.0.3 — Documenter les contraintes assumées
**À faire** (table dans la doc) :
- [ ] **SSE `initSSE()` avant tout `await`** : contrainte de **tous les adaptateurs runtime-Web (Bun + Cloudflare)**,
      pas seulement Bun — elle vit dans `_sseWindowClosed`/`_closeSseWindow` de `WebApiResponseBase`. Le message
      d'erreur est paramétré par `_adapterName` (vérifier que chaque sous-classe le set).
- [ ] **Streaming** :
  - **live** (vrai `ReadableStream` / `res.write`) sur **node, bun, cloudflare**.
  - **bufferisé** (réponse en un bloc) sur **vercel + netlify uniquement** (shim Node dans
    `applyResponseMethods`). ⚠️ Cloudflare est serverless mais streame **live** car il passe par le modèle Web.
- [ ] Node : distribution des requêtes = round-robin OS (SCHED_RR).
- [ ] `defaultHeaders` : selon la décision de 0.5.8, node/bun(/cf) — documenter le périmètre exact.
- [ ] Différences de parsing/headers entre runtimes s'il y en a.

### 1.0.4 — Gel semver + migration
**À faire** :
- [ ] Geler la surface publique (relire tous les `export` de `src/index.ts` et `src/types/index.ts`).
- [ ] Guide de migration depuis Express (le public cible le plus probable).
- [ ] CHANGELOG clair, conventions semver annoncées.
- [ ] Tag **1.0.0**.

---

## Post-1.0 (assumé hors périmètre du 1.0)

- [ ] **WebSockets** : SSE existe (client SSE node-natif via `http`/`https` dans `src/sse/client.ts` — c'est
      *ça* le « natif Node », pas du WS), WS non. Côté serveur, **pas de WS natif exploitable uniformément** :
      Node core n'a que l'événement `'upgrade'` (handshake brut RFC 6455 à écrire à la main → en pratique = `ws`,
      donc non « zéro-dep ») ; **seul Bun** a un vrai WS natif (`Bun.serve({ websocket })`), mais Bun-only ;
      serverless (vercel/netlify/cloudflare) ne supporte pas les WS classiques (CF = Durable Objects, hors sujet).
      → Conclusion : **hors scope** très probable, mais à déclarer **explicitement** (ne pas laisser le flou).
- [ ] **CSRF + security-headers middleware** (opt-in) : avec cookies + forms, l'absence se remarque.
- [ ] **Hooks compatibles OpenTelemetry** : le monitoring custom (EventEmitter, percentiles, alarmes) est
      sympa en dev mais réinvente la roue et reste dev-only. Pour la prod, des hooks de cycle de vie capables
      d'émettre des spans valent plus que des percentiles maison.
- [ ] **Extraire monitoring (et à terme le worker-supervisor) hors du core** → `@lacis/monitoring`. « Zéro-dep »
      concerne le runtime, mais la complexité interne a un coût de maintenance et de surface API à figer en 1.0.
      Un core lean sert mieux la promesse. (Opinion d'archi, à arbitrer.)
- [ ] **`req.platform` à plat (`req.env`/`req.ctx`) ou génériquable** : si un jour l'accès regroupé `req.platform`
      gêne, possibilité d'un `Request<P>` génériquable par adaptateur — gros chantier de propagation, non prioritaire.

---

## Récap priorités

| Phase | Tâche | Bloquant 1.0 | Breaking si fait après 1.0 |
|---|---|---|---|
| 0.5 | loadBalancing : rename + ménage | oui (vérité/cohérence) | oui (rename API) |
| 0.5 | req.form urlencoded | non (additif) | non |
| 0.5 | MAX_BODY_SIZE configurable | non (additif) | non |
| 0.5 | polish OSS/ESM | oui (image) | non |
| 0.5 | réponses typées/enforced | recommandé | **oui** |
| 0.5 | locals (global) | recommandé | **oui** |
| 0.5 | adaptateur Cloudflare (+ refactor bun/web-base) | oui (pitch + support de 0.5.8/0.5.9) | non |
| 0.5 | 405 `Allow` + parité adaptateurs | oui (conformité) | non |
| 0.5 | `req.platform` env/ctx/cf (merging) | recommandé | **oui** (nom/forme) |
| 1.0 | middleware `use:` dans defineHandler | non (additif) | **oui si inférence locals reportée** |
| 1.0 | doc client OpenAPI | non | non |
| 1.0 | doc contraintes assumées | oui | non |
| 1.0 | gel semver + migration | oui | — |
