# Audio Split — séparation voix / bruit pour Premiere Pro

Extension **UXP pour Adobe Premiere Pro** qui isole la **voix** et le **bruit de fond**
d'un clip audio sélectionné, en un clic, grâce à des modèles IA (Kim Vocal 2 /
MelBand RoFormer). Les stems sont posés sur de nouvelles pistes sous ton clip et
enregistrés à côté du fichier source.

- 🎙️ Sépare **voix** et **bruit de fond** d'un clip
- 🎚️ Garde ce que tu veux audible (voix seule, bruit seul, ou les deux)
- ⚡ Accéléré **GPU** (NVIDIA/CUDA, Apple CoreML) — CPU sinon
- 💾 Stems écrits **à côté du média** d'origine (`… - Voix.wav`, `… - Bruit.wav`)
- 🎛️ Déclenchable depuis un **Stream Deck** (appel HTTP)

---

## Installation (utilisateur)

Il y a **deux éléments** à installer, une fois :

### 1. Le plugin
1. Télécharge **`AudioSplit.ccx`** depuis la [dernière release](https://github.com/Selgy/PremiereAudioSplit/releases/latest).
2. **Double-clique** le fichier → l'app Creative Cloud l'installe. Comme il ne vient
   pas du Marketplace, clique **Install** sur l'avertissement.
3. Ouvre Premiere → **Fenêtre › Extensions › Audio Split**.

### 2. Le moteur
À la première ouverture, le panneau indique « Moteur non installé ».
1. Clique **« Installer le moteur »** → il télécharge l'installeur adapté à ton OS
   et ouvre le dossier.
2. Lance l'installeur :
   - **Windows** : `AudioSplit-Engine-Windows.exe` (sans droits admin). Si SmartScreen
     s'affiche : *Informations complémentaires › Exécuter quand même*.
   - **macOS** : `AudioSplit-Engine-macOS.pkg` — **non notarisé**, voir
     [contournement Gatekeeper](docs/INSTALL.md#macos).
3. Reviens dans le panneau : il détecte le moteur et le démarre tout seul (pastille
   verte **Prêt**).

> Le modèle IA se télécharge automatiquement au premier usage (une fois).

---

## Utilisation

1. Sélectionne **un clip audio** dans la timeline.
2. Choisis quoi **garder audible** (Les deux / Voix / Bruit) et la **qualité**.
3. Clique **« Séparer la voix »**.

Résultat : deux nouvelles pistes audio sous ton clip (voix + bruit), le clip
d'origine muté (option), et les fichiers `… - Voix.wav` / `… - Bruit.wav`
enregistrés à côté de ta vidéo source.

### Qualité
- **Rapide** — Kim Vocal 2 (MDX-Net). Léger, rapide, très bon.
- **Max** — MelBand RoFormer. Meilleure séparation, plus lourd (conseillé avec GPU).

Le défaut s'adapte : **Max** si GPU détecté, **Rapide** sinon.

### Stream Deck
Ajoute un bouton **Système › Site Web** :
- URL : `http://localhost:8765/trigger`
- **Demande GET en arrière-plan**

Appuyer sur la touche lance la séparation sur le clip sélectionné (le panneau doit
être ouvert dans Premiere).

---

## Prérequis
- **Premiere Pro ≥ 25.6** (UXP)
- **Windows 10/11** ou **macOS**
- GPU conseillé (NVIDIA CUDA / Apple Silicon) — fonctionne en CPU (plus lent)

## Dépannage
- **Panneau « Non installé » alors que c'est installé** → ferme/rouvre le panneau.
- **Reste « Hors ligne »** → le moteur a planté au démarrage ; log dans
  `%TEMP%\premiere-audio-split\engine.log` (Windows).
- **Première séparation lente** → téléchargement du modèle (une fois).
- Détails : [docs/INSTALL.md](docs/INSTALL.md).

---

## Développement / build

- Architecture, plan et notes : [docs/PLAN.md](docs/PLAN.md).
- Construire les installeurs du moteur et packager le `.ccx` : [docs/PACKAGING.md](docs/PACKAGING.md).
- Le moteur (backend Python) : [backend/](backend/). Le plugin UXP : [plugin/](plugin/).

Licence : à définir.
