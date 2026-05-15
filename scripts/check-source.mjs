#!/usr/bin/env node
/**
 * check-source.mjs — gate de qualidade rodado em CI e local antes do build.
 * Falha com exit code 1 se alguma regra de "constituição técnica" do projeto
 * for violada:
 *   1. Nenhum arquivo WOFF2 deve existir em /public/fonts (WOFF1 obrigatório).
 *   2. Nenhuma importação @fontsource (que serve WOFF2) no /src.
 *   3. Funções em supabase/functions/ devem ter nome kebab-case.
 *   4. Nenhum import de Next/Remix/Prisma/Drizzle/Redux (stack proibida).
 *   5. Edge Functions implementadas (não devem ser stubs <10 linhas).
 *   6. Não pode haver mock data hardcoded em src/state.tsx (legado do GPT-PRO).
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const errors = [];
const warnings = [];

function walk(dir, accept = () => true) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || name === 'node_modules' || name === 'dist') continue;
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) out.push(...walk(full, accept));
    else if (accept(full)) out.push(full);
  }
  return out;
}

// 1. WOFF1 only
const fontsDir = join(ROOT, 'public/fonts');
if (existsSync(fontsDir)) {
  const fonts = readdirSync(fontsDir);
  const woff2 = fonts.filter((f) => f.endsWith('.woff2'));
  if (woff2.length > 0) errors.push(`WOFF2 proibido. Arquivos: ${woff2.join(', ')}`);
  const hasWoff = fonts.some((f) => f.endsWith('.woff'));
  if (!hasWoff) errors.push('public/fonts/ não contém nenhum .woff (WOFF1 é obrigatório)');
}

// 2. Nenhum @fontsource em src/ (em IMPORTS — não em comentários)
const srcFiles = walk(join(ROOT, 'src'), (p) => /\.(ts|tsx|css)$/.test(p));
for (const f of srcFiles) {
  const txt = readFileSync(f, 'utf-8');
  // Casa em: import ... from '@fontsource/...'; require('@fontsource/...'); @import url(@fontsource/...)
  const importsFontsource = /(^|\n)\s*import\s+[^;]*['"]@fontsource\//.test(txt) ||
                            /require\(\s*['"]@fontsource\//.test(txt) ||
                            /@import\s+['"]@fontsource\//.test(txt);
  if (importsFontsource) {
    errors.push(`@fontsource (WOFF2) importado em ${relative(ROOT, f)}`);
  }
}

// 3. Kebab-case em supabase/functions/
const fnDir = join(ROOT, 'supabase/functions');
if (existsSync(fnDir)) {
  for (const name of readdirSync(fnDir)) {
    if (name.startsWith('_') || name.endsWith('.json') || name.endsWith('.ts')) continue;
    if (!/^[a-z][a-z0-9-]*$/.test(name)) {
      errors.push(`Função "${name}" não está em kebab-case`);
    }
  }
}

// 4. Stack proibida
const FORBIDDEN = [
  { pattern: /from\s+['"]next\//, msg: 'Next.js proibido' },
  { pattern: /from\s+['"]@remix-run\//, msg: 'Remix proibido' },
  { pattern: /from\s+['"]@prisma\//, msg: 'Prisma proibido' },
  { pattern: /from\s+['"]drizzle-orm/, msg: 'Drizzle proibido' },
  { pattern: /from\s+['"]@reduxjs\/toolkit/, msg: 'Redux Toolkit proibido' },
  { pattern: /from\s+['"]styled-components/, msg: 'styled-components proibido (use Tailwind)' },
  { pattern: /from\s+['"]@emotion\//, msg: 'Emotion proibido (use Tailwind)' },
];
for (const f of srcFiles) {
  if (!/\.(ts|tsx)$/.test(f)) continue;
  const txt = readFileSync(f, 'utf-8');
  for (const { pattern, msg } of FORBIDDEN) {
    if (pattern.test(txt)) {
      errors.push(`${msg} em ${relative(ROOT, f)}`);
    }
  }
}

// 5. Edge Functions não devem ser stubs
if (existsSync(fnDir)) {
  for (const name of readdirSync(fnDir)) {
    if (name.startsWith('_') || name.endsWith('.json')) continue;
    const idx = join(fnDir, name, 'index.ts');
    if (!existsSync(idx)) {
      warnings.push(`Edge Function ${name}/index.ts não existe`);
      continue;
    }
    const lines = readFileSync(idx, 'utf-8').split('\n').length;
    if (lines < 15) {
      warnings.push(`Edge Function ${name} muito curta (${lines} linhas) — possível stub`);
    }
  }
}

// 6. Mock data
const stateFile = join(ROOT, 'src/state.tsx');
if (existsSync(stateFile)) {
  warnings.push('src/state.tsx existe — esse arquivo pode conter mock data legacy do GPT-PRO');
}

// Imprime relatório
console.log('=== check-source ===');
if (errors.length === 0 && warnings.length === 0) {
  console.log('✓ Tudo conforme. Nenhuma violação detectada.');
} else {
  if (warnings.length > 0) {
    console.log(`\nAvisos (${warnings.length}):`);
    for (const w of warnings) console.log(`  ⚠ ${w}`);
  }
  if (errors.length > 0) {
    console.log(`\nErros (${errors.length}):`);
    for (const e of errors) console.log(`  ✗ ${e}`);
  }
}

process.exit(errors.length > 0 ? 1 : 0);
