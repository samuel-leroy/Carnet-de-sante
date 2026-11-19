# Carnet de santé des chats — mise en service

## 1. Héberger l'appli (GitHub Pages)
1. Crée un dépôt public nommé **carnet-chats** (le nom compte : le manifest utilise `/carnet-chats/`).
2. Envoie-y le contenu du dossier (index.html, app.js, style.css, config.js, sw.js, manifest.json et les 4 icônes PNG).
3. Settings → Pages → branche `main`, dossier `/ (root)`.
4. L'appli sera sur `https://<ton-compte>.github.io/carnet-chats/`.

Seul le code est public. Tes données (fiches, poids, photos, documents) ne passent jamais par GitHub : elles restent sur ton téléphone et dans ton Google Drive.

## 2. Brancher Google Drive
Même domaine `github.io` que ton Carnet d'entretien : tu peux réutiliser **le même identifiant client OAuth** (type « Application Web »), l'origine JavaScript est déjà autorisée.
- Soit tu le colles dans `config.js` (`GOOGLE_CLIENT_ID`) avant d'envoyer les fichiers,
- soit dans l'appli : ☰ Menu → Paramètres → Identifiant client Google → Enregistrer.

Puis appuie sur le nuage ☁️ : Google demande l'autorisation (accès limité aux fichiers créés par l'appli). Un dossier **Carnet Chats** apparaît dans ton Drive :
- `carnet-chats.json` : toutes les données
- `Photos/` et `Documents/` : les fichiers

Pastille du nuage : verte = synchronisé, jaune = modifications à envoyer, grise = pas encore connecté.
**Utilisation à deux (compte Google commun)** : sur le téléphone de ta conjointe, installe l'appli de la même façon, puis appuie sur le nuage ☁️ et choisis le compte Google commun. Vous partagez alors le même dossier « Carnet Chats » : chacun voit les ajouts de l'autre.
- L'appli se synchronise toute seule à l'ouverture, au retour dans l'appli et quelques secondes après chaque modification. Le nuage permet de forcer la synchro.
- Si vous modifiez la même fiche en même temps, la modification la plus récente l'emporte ; les ajouts différents (pesées, soins, photos) se cumulent sans rien perdre.

## 3. Créer l'application Android avec PWABuilder
1. Va sur **pwabuilder.com** et saisis l'adresse de l'appli ci-dessus.
2. Vérifie le score (manifest + service worker doivent être verts).
3. **Package for stores → Android** → renseigne le nom, l'identifiant de package (ex. `fr.tonnom.carnetchats`), génère.
4. Télécharge le zip : il contient l'APK/AAB et la clé de signature. **Garde la clé précieusement** : elle sert pour toutes les futures mises à jour.
5. Installe l'APK sur le téléphone.

Alternative sans PWABuilder : ouvre l'adresse dans Chrome → menu ⋮ → « Installer l'application ».

## 4. Mises à jour
Remplace simplement les fichiers sur GitHub (sans toucher aux icônes si tu les personnalises). Les données ne sont jamais perdues : elles vivent dans le navigateur et dans le Drive, pas dans les fichiers de l'appli. Pour forcer le rechargement, incrémente `CACHE` dans `sw.js`.

## Ce que contient l'appli
Une fiche par chat avec : identité (puce, tatouage, robe, alimentation, allergies), poids avec courbe et variation, santé (vaccins, vermifuge, antiparasitaire, traitements, consultations, analyses, dentaire, chirurgie) avec rappels « Fait ✓ », galerie photos par mois, documents médicaux (PDF/photos), notes, contacts clés (vétérinaire, urgences, assurance — communs aux chats) et chaleurs.
