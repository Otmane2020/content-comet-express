import type { PlatformId } from "@/lib/geo";

export type PlatformGuide = {
  time: string;
  summary: string;
  steps: { title: string; detail: string }[];
  tips?: string[];
  docUrl?: string;
};

export const PLATFORM_GUIDES: Record<PlatformId, PlatformGuide> = {
  wordpress: {
    time: "2 min",
    summary:
      "On publie via l'API REST officielle de WordPress. Aucun plugin à installer : il suffit d'un mot de passe d'application.",
    steps: [
      { title: "Ouvre ton admin WordPress", detail: "Va sur https://tonsite.com/wp-admin puis Utilisateurs → Profil (ton compte administrateur)." },
      { title: "Crée un mot de passe d'application", detail: "Descends jusqu'à « Mots de passe d'application », saisis le nom AutopilotGEO puis clique sur « Ajouter »." },
      { title: "Copie le code affiché", detail: "WordPress affiche une suite du type « abcd efgh ijkl mnop ». Elle n'apparaît qu'une seule fois — copie-la tout de suite." },
      { title: "Colle les infos ici", detail: "Site URL = l'adresse de ton site, Username = ton identifiant WordPress, Application password = le code copié." },
    ],
    tips: [
      "Si la section n'apparaît pas, ton site doit être en HTTPS (WordPress 5.6+).",
      "Les articles arrivent en brouillon ou publiés selon ton réglage d'autopilot.",
    ],
    docUrl: "https://wordpress.org/documentation/article/application-passwords/",
  },
  woocommerce: {
    time: "2 min",
    summary:
      "Une boutique WooCommerce reste un site WordPress : on publie les articles de blog via l'API REST WordPress de la boutique.",
    steps: [
      { title: "Connecte-toi à l'admin de la boutique", detail: "https://taboutique.com/wp-admin avec un compte administrateur." },
      { title: "Utilisateurs → Profil", detail: "Section « Mots de passe d'application », nom AutopilotGEO, puis « Ajouter »." },
      { title: "Copie le mot de passe généré", detail: "Il ne s'affiche qu'une fois. Garde-le de côté." },
      { title: "Renseigne le formulaire", detail: "Store URL, Username et Application password. On teste la connexion immédiatement." },
    ],
    tips: ["Les articles produits/guides d'achat renforcent le SEO shopping de la boutique."],
    docUrl: "https://wordpress.org/documentation/article/application-passwords/",
  },
  prestashop: {
    time: "3 min",
    summary:
      "PrestaShop expose un webservice. On crée une clé avec les droits d'écriture sur le contenu (CMS / blog).",
    steps: [
      { title: "Active le webservice", detail: "Back-office → Paramètres avancés → Webservice → « Activer le service web » sur Oui." },
      { title: "Ajoute une clé", detail: "Clique sur « Ajouter une nouvelle clé » puis « Générer » pour créer la clé." },
      { title: "Donne les permissions", detail: "Coche au minimum View + Add + Modify sur les ressources content / cms (et blog si tu utilises un module)." },
      { title: "Enregistre puis copie la clé", detail: "Colle l'URL de la boutique et la clé webservice dans le formulaire." },
    ],
    tips: ["Si tu utilises un module blog tiers, active aussi ses ressources dans les permissions."],
    docUrl: "https://devdocs.prestashop-project.org/8/webservice/tutorials/creating-access/",
  },
  shopify: {
    time: "4 min",
    summary:
      "On publie dans un blog Shopify via l'Admin API. Il faut une app personnalisée avec le scope write_content et l'ID du blog.",
    steps: [
      { title: "Crée une app personnalisée", detail: "Admin Shopify → Paramètres → Applications et canaux de vente → Développer des applications → Créer une application." },
      { title: "Autorise l'écriture de contenu", detail: "Configuration → Admin API → coche write_content et read_content, puis Enregistrer." },
      { title: "Installe et copie le token", detail: "Onglet Identifiants API → Installer l'application → copie le jeton d'accès Admin API (shpat_…)." },
      { title: "Récupère l'ID du blog", detail: "Admin → Contenu → Articles de blog → ouvre ton blog : l'ID est le nombre à la fin de l'URL (…/blogs/123456789)." },
      { title: "Remplis le formulaire", detail: "Shop domain = mastore.myshopify.com, Blog ID, Admin API token." },
    ],
    docUrl: "https://help.shopify.com/en/manual/apps/app-types/custom-apps",
  },
  webhook: {
    time: "5 min",
    summary:
      "Pour un site Lovable, Bolt, Replit, Next.js ou headless : on envoie chaque article en POST JSON sur ton endpoint. Tu décides quoi en faire.",
    steps: [
      { title: "Crée une route publique", detail: "Ex. /api/public/articles qui accepte une requête POST en JSON." },
      { title: "Attends ce format", detail: "{ title, slug, excerpt, markdown, html, cover_url, keywords[], published_at }" },
      { title: "Sécurise avec un secret", detail: "On envoie l'en-tête x-autopilot-secret ; vérifie sa valeur avant d'enregistrer l'article." },
      { title: "Colle l'URL ici", detail: "Endpoint URL + le même secret. Une réponse 200 vaut publication réussie." },
    ],
    tips: ["Réponds en moins de 10 s, sinon la publication est marquée en erreur et réessayée."],
  },
};
