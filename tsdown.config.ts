import { defineConfig } from 'tsdown'

const lib = {
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['esm'] as const,
  platform: 'node' as const,
  target: 'es2024',
  dts: true,
  clean: true,
  fixedExtension: false,
  external: [/^@deepseek-ai\//, /^node:/],
}

const CLIENT_EXTERNALS = ['react']

const client = {
  name: 'dsh-plugin-mirobody/client',
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs' as const,
  platform: 'browser' as const,
  dts: false,
  clean: false,
  sourcemap: true,
  external: CLIENT_EXTERNALS,
  noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "dsh-plugin-mirobody", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default defineConfig([lib, client])
