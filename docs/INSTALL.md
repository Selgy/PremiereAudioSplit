# Installation (utilisateur final)

Deux éléments à installer, une seule fois :

1. **Le plugin** `AudioSplit.ccx` (le panneau dans Premiere)
2. **Le moteur** (le programme qui fait la séparation)

Le moteur peut s'installer **directement depuis le panneau** (bouton
« Installer le moteur »), ou manuellement (ci-dessous).

---

## 1. Installer le plugin

- Double-clique **`AudioSplit.ccx`** → Creative Cloud l'installe.
- Ouvre Premiere Pro → menu **Fenêtre > Extensions > Audio Split**.

À la première ouverture, si le moteur n'est pas là, le panneau affiche
**« Installer le moteur »**. Clique dessus : il télécharge l'installeur adapté à
ton OS et ouvre le dossier. Lance ensuite l'installeur (voir ci-dessous selon l'OS).

---

## 2. Installer le moteur

### Windows

1. Lance **`AudioSplit-Engine-Windows.exe`**.
2. Suis l'assistant (installation sans droits admin).
3. Reviens dans le panneau → il détecte le moteur et le démarre tout seul.

> ⚠️ Windows SmartScreen peut afficher un avertissement (éditeur inconnu).
> Clique **Informations complémentaires → Exécuter quand même**.

### macOS — ⚠️ contournement Gatekeeper requis

Le moteur Mac **n'est pas notarisé par Apple** (pour éviter l'abonnement
développeur à 99 $/an). macOS le bloque donc par défaut. Contournement, au choix :

**Méthode A — clic droit (la plus simple)**
1. Dans le Finder, **clic droit** sur `AudioSplit-Engine-macOS.pkg` → **Ouvrir**.
2. Dans la boîte de dialogue, clique de nouveau **Ouvrir**.
3. Suis l'installation.

**Méthode B — Réglages Système**
1. Double-clique le `.pkg` (il est bloqué) → ferme l'alerte.
2. **Réglages Système > Confidentialité et sécurité**.
3. En bas, « … a été bloqué » → **Ouvrir quand même**.

**Méthode C — Terminal (si A et B échouent)**
```bash
xattr -dr com.apple.quarantine ~/Downloads/AudioSplit-Engine-macOS.pkg
```
Puis double-clique le `.pkg`.

> Après installation, l'app moteur vit dans `/Applications`. Au premier lancement
> via le panneau, macOS peut redemander une autorisation : **Ouvrir quand même**.

---

## Désinstallation

- **Windows** : Paramètres > Applications > *AudioSplit Engine* > Désinstaller.
- **macOS** : supprime `/Applications/AudioSplitEngine.app`.
- **Plugin** : via Creative Cloud > Marketplace > Gérer les modules.

---

## Dépannage

- **Panneau : « Moteur non installé »** alors qu'il l'est → ferme/rouvre le
  panneau (le schéma `audiosplit://` se déclenche à l'ouverture).
- **Reste « hors ligne »** → le moteur a peut-être planté au démarrage. Lance-le
  manuellement une fois pour voir l'erreur (Windows : l'`.exe` dans
  `%LOCALAPPDATA%\Programs\AudioSplitEngine\`).
- **Première séparation lente** → le modèle (Kim Vocal 2) se télécharge au 1er usage.
