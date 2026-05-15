/**
 * geoCon — Configuração em RUNTIME (browser).
 *
 * Edite este arquivo após o build para apontar para seu Supabase, sem
 * precisar reconstruir o bundle.
 *
 * MODO PRODUÇÃO (atualmente LIGADO):
 *   SKIP_AUTH = false → login real via Supabase Auth.
 *
 * MODO DEMO:
 *   SKIP_AUTH = true → pula login, mostra dados mockados em todas as telas.
 */
window.GEOCON_CONFIG = {
  SKIP_AUTH:           false,

  SUPABASE_URL:        "https://rmqrztozesnzaomjrpny.supabase.co",
  SUPABASE_ANON_KEY:   "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJtcXJ6dG96ZXNuemFvbWpycG55Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2MDk4NzUsImV4cCI6MjA5NDE4NTg3NX0.rgGkdQfQTD19exUe5WZ9w6YO6nQ_WHo8ZVkBcxhASLo",
  SITE_URL:            "https://contratos.consultegeo.org",
  IDENTITY_HUB_URL:    "https://app.consultegeo.org",
  PRODUCT_NAME:        "geoCon",
  PRODUCT_LONG_NAME:   "Consulte GEO — Gestão de Contratos"
};
