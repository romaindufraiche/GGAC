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
