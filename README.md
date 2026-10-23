# Orbit

Centre de commandement patrimonial : ce que les événements du monde changent, en temps réel, pour le patrimoine d'un client à 60 ans.

## Lancer

```
pip install -r requirements.txt
uvicorn backend.app:app --port 8000
```
Puis ouvrir http://localhost:8000.

## Modules
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
