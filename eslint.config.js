import js from '@eslint/js';
import globals from 'globals';
import babelParser from '@babel/eslint-parser';

export default [
  { ignores: ['node_modules/**'] },
  js.configs.recommended,
  { languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  {
    files: ['**/*.jsx'],
    languageOptions: { parser: babelParser, parserOptions: { requireConfigFile: false, babelOptions: { parserOpts: { plugins: ['jsx'] } } } },
    // JSX component identifiers are resolved by Forge's compiler.
    rules: { 'no-unused-vars': 'off' },
  },
];
