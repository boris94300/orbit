# Orbit

Se projeter dans son futur financier : une silhouette qui vieillit avec le curseur du temps, et un patrimoine rejoué sur les vraies séquences de marché 1996-2025.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/boris94300/orbit)

Compte démo : `camille.moreau@orbit.demo` / `Orbit-2026`.

## Lancer en local

```
pip install -r requirements.txt
uvicorn backend.app:app --port 8000
```
Puis ouvrir http://localhost:8000.

## Déployer sur Render

Le bouton ci-dessus lit `render.yaml` (plan gratuit, redéploiement automatique à chaque push sur `main`). Sur le plan gratuit, le disque est temporaire : les comptes créés sont perdus à chaque redéploiement, le compte démo est recréé au démarrage.

## Application
- **Ma vie** : silhouette 3D qui vieillit (course, marche, canne), patrimoine défavorable / médian / favorable, leviers « Et si… », objectif retraite, jalons, mini-globe.
- **Mes choix** : louer ou acheter, épargne, placement, âge de retraite, scénario composé, détail année par année.
- **Agents** : appels d'API, données reçues, calculs et contrôles en direct.
- **Profil** : informations modifiables, double authentification TOTP (QR code).
- `/pro` : console d'origine (vue banque).

## Console /pro
- **Monde** : globe 3D, indices, taux BCE/€STR, inflation et chômage Eurostat, changes, crypto, séismes USGS, événements NASA EONET, presse financière (RSS).
- **Portefeuille** : cliente fictive valorisée sur les cours du jour, allocation, exposition géographique, risques Géorisques, graphe événement → position → enveloppe.
- **Horizon 60** : projection Monte-Carlo (3 000 scénarios, euros constants), curseurs, leviers chiffrés, note de projection.
- **Agents** : Veille, Exposition, Projection, Action, Conformité, Note. Mandat plafonné, validation humaine, journal d'audit chaîné SHA-256 (`data/audit.jsonl`).
- **Conseiller** : agence simulée (184 clients), file de priorité à motifs explicites, messages préparés.
- **Enquête** : panneau à onglets détaillant la transmission d'un événement au portefeuille.

## Principes
- Les chiffres viennent de calculs déterministes, jamais d'un modèle de langage.
- Chaque flux est mis en cache. En cas d'indisponibilité, le dernier instantané (`data/snapshot.json`) est servi et signalé.
- Aucune clé requise. Un LLM optionnel peut reformuler la note client ; sa sortie est rejetée si un chiffre diffère :
  - `MISTRAL_API_KEY` (et `MISTRAL_MODEL`), ou
  - `ANTHROPIC_API_KEY`, ou
  - `OLLAMA_MODEL` (et `OLLAMA_HOST`) pour un modèle local.
- Les opérations sont simulées : aucun ordre réel n'est transmis.

## Sources
BCE Data API, Eurostat, Frankfurter, Yahoo Finance (spark), Kraken, USGS, NASA EONET, Géorisques, flux RSS BCE / Le Monde / BBC / Google News.
