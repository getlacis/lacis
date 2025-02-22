# Zeno

**Zeno** est un framework web léger et performant pour TypeScript, conçu pour offrir une simplicité maximale et une grande flexibilité. Il permet une gestion intuitive des routes basées sur des fichiers et des dossiers, facilitant ainsi la création d'APIs et d'applications web tout en garantissant des performances élevées.

> **Avertissement**  
> Ce projet est destiné à des fins éducatives uniquement. Il n'est pas prêt pour un environnement de production et ne doit pas être utilisé en production. Utilisez-le à vos risques et périls, et assurez-vous de réaliser des tests approfondis avant de l'envisager pour une utilisation en production.


## Caractéristiques

- **Basé sur des fichiers et des dossiers** : Les routes sont automatiquement générées à partir de la structure des dossiers dans le répertoire `routes/`. Cela simplifie la gestion des routes et facilite la maintenance du code.
  
- **Support des routes dynamiques** : Vous pouvez facilement créer des routes dynamiques en utilisant des paramètres de modèle directement dans le nom des fichiers et des dossiers, par exemple `api/[model].ts`.

- **Routes statiques** : Créez des routes statiques directement à partir de fichiers de type `.ts` dans des dossiers dédiés (par exemple `api/methods.ts`).

- **Performances optimisées** : Zeno est conçu pour être ultra-performant avec une gestion efficace des routes et une faible empreinte mémoire.

- **Structure simple** : Organisez facilement vos routes en fonction des fichiers et dossiers, ce qui rend le code plus lisible et mieux structuré.

- **Hot reloading** : Actualiser automatiquement l'application lors des modifications du code, offrant ainsi une expérience de développement fluide et instantanée sans avoir à redémarrer manuellement le serveur.

## Installation

### Prérequis

Zeno nécessite **Node.js** et **npm** ou **yarn** pour fonctionner. Assurez-vous d'avoir ces outils installés avant de commencer.

<!--
### Installation via npm

```bash
npm install zeno
```

### Installation via yarn

```bash
yarn add zeno
```
-->

## Exemple de Structure de Projet

Voici un exemple de structure de dossier que vous pouvez utiliser dans votre projet Zeno :

```
/project-root
  /src
    /routes
      /api
        [model].ts        # Route dynamique pour un modèle
        methods.ts           # Route statique
```

### Exemple de code pour une route dynamique

**routes/api/[model].ts** :

```typescript
import { Request, Response } from 'zeno';

export default async function handler(req: Request, res: Response) {
  const model = req.params.model;  // 'model' correspond au nom du fichier entre crochets [model]
  
  res.send(`Model: ${model}`);
}
```

### Exemple de code pour une route statique

**routes/api/methods.ts** :

```typescript
import { Request, Response } from 'zeno';

export default async function handler(req: Request, res: Response) {
  res.send('Ceci est une route statique: /api/methods');
}
```

## Démarrer le Serveur

Pour démarrer un serveur avec Zeno, vous pouvez utiliser la fonction `createServer` fournie par le framework.

```typescript
import { createServer } from 'zeno';
import path from 'path';

const server = createServer({
  routesDir: path.join(__dirname, 'routes'),  // Dossier où sont définies vos routes
  port: 3000  // Port sur lequel le serveur écoute
});

server.listen();
```

## Routes

### Routes dynamiques

Les routes dynamiques sont créées à partir de fichiers avec des noms de type `[param]`, où `param` est le nom du paramètre de la route. Par exemple :

- **routes/api/[model].ts** : Une route dynamique où `[model]` peut être n'importe quel modèle passé dans l'URL, comme `/api/user`, `/api/product`, etc.

### Routes statiques

Les routes statiques sont des fichiers `.ts` classiques dans les répertoires de routes. Par exemple, une route statique pour `/api/methods` sera créée à partir de **routes/api/methods.ts**.

## Commandes NPM

### Lancer en mode développement

```bash
npm run dev
```

Cela démarrera un serveur local en mode développement, avec un rechargement automatique des fichiers.

### Compiler en mode production

```bash
npm run build
```

Cela compilera votre code en JavaScript et préparera votre projet pour la production.

### Lancer le serveur en mode production

```bash
npm run start
```

Cela démarrera le serveur en mode production, sans rechargement automatique.

## Contribution

Zeno est open-source et nous encourageons les contributions ! Si vous souhaitez ajouter une fonctionnalité, corriger un bug, ou améliorer la documentation, n'hésitez pas à créer une pull request.

## License

Zeno est sous la **MIT License**. Voir le fichier [LICENSE](LICENSE) pour plus de détails.

---

## Explication de l'architecture :

- **Routes dynamiques** : Les fichiers dans le répertoire `routes/` sont traités comme des routes. Si un fichier utilise la syntaxe `[param]` dans son nom (comme `api/[model].ts`), il est traité comme une route dynamique où `model` sera un paramètre de la requête. Par exemple, une requête à `/api/user` fera correspondre le fichier `api/[model].ts` et vous pourrez récupérer la valeur de `model` comme `req.params.model`.

- **Routes statiques** : Les fichiers comme `api/methods.ts` sont traités comme des routes statiques et sont accessibles directement à l'URL `/api/methods`.

### Avantages de Zeno :
- **Simplicité** : Il est facile à configurer et à utiliser, avec une structure de fichiers intuitive.
- **Flexibilité** : Il permet de créer des API et des applications web de manière modulaire.
- **Performance** : Zeno est conçu pour fonctionner avec une faible latence et une gestion optimisée des routes.

---

- ✨ Funfact: Le nom du projet vient du philosophe Zénon et du personnage Zeno de dragon ball. Inutile comme info, faites-en ce que vous voulez.
