# G.G.A.C. — site et espace d'administration

Refonte du site du Groupe des Généalogistes Amateurs du Cambrésis : site public (motion design) + espace d'administration.

## Fonctionnement

- `server/` : serveur Node (Express) qui génère les pages à partir d'une base **PostgreSQL**.
- `assets/` : styles, scripts et images du site public ; `assets/admin/` pour l'administration.
- `server/seed/` : contenu initial (les 133 pages publiques d'origine + l'agenda), importé automatiquement au premier démarrage si la base est vide.
- `build/` : scripts qui ont produit ce contenu initial à partir de www.ggac.fr (`crawl.py` puis `build.py`).

## Administration (`/admin`)

- **Tableau de bord** : prochaines manifestations, permanences, activité récente.
- **Agenda** : ajout / modification / suppression / publication des manifestations (avec affiche),
  permanences (ajout, suppression groupée, générateur « tous les mercredis + 4ᵉ samedi, hors juillet-août et jours fériés »),
  texte de présentation.
- **Pages** : éditeur visuel de chacune des pages, aperçu avant publication, historique des 30 dernières versions avec restauration,
  menu latéral, création / masquage / suppression de pages.
- **Menus** : menu principal (3 niveaux) par glisser-déposer.
- **Médiathèque** : images et PDF stockés en base.
- **Utilisateurs** (administrateurs / rédacteurs) et **Réglages** (compteur de visiteurs, nombre d'éléments affichés).

## Généalogie

- **Espace membre** (`/genealogie`, membres connectés) : recherche avancée (opérateurs contient / égal / commence par / finit par / existe,
  années ±2/5/10 ans, avant/après, ET/OU, conjoints, décès), recherche familles, index des patronymes, fiche individuelle,
  arbre d'ascendance animé (2 à 6 générations, navigation sans rechargement) et descendance dépliable.
- **Administration** (`/admin/genealogie`) : arbres, import GEDCOM (UTF-8, ANSI, ANSEL ; le contenu de l'arbre est remplacé),
  export GEDCOM 5.5.1, formulaires de saisie des personnes et des familles (parents, conjoints, enfants, autocomplétion),
  dates saisies en clair (« 12/03/1756 », « vers 1750 ») converties au format GEDCOM.
- **Vie privée** : les personnes probablement vivantes (pas de décès connu, née il y a moins de 100 ans) sont masquées ;
  réglable dans l'admin et forçable fiche par fiche.
- `tests/make-fixture.js` génère un fichier GEDCOM **fictif** (`tests/fixtures/`) pour les essais.

## Variables d'environnement

| Variable | Rôle |
| --- | --- |
| `DATABASE_URL` | chaîne de connexion PostgreSQL (obligatoire) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | premier compte administrateur, créé au premier démarrage |
| `PGSSL=require` | force SSL vers la base (automatique pour les URL externes Render) |

## Lancer en local

```bash
npm install
DATABASE_URL=postgres://… ADMIN_EMAIL=… ADMIN_PASSWORD=… npm start
```
