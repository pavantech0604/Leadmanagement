import js from '@eslint/js';
import ts from 'typescript-eslint';

export default ts.config(
 {ignores:['.next/**','node_modules/**','data/**','next-env.d.ts']},
 {files:['app/**/*.{ts,tsx}','components/**/*.{ts,tsx}','lib/**/*.ts'],extends:[js.configs.recommended,...ts.configs.recommended],rules:{
  // Existing API response shapes are validated at runtime with Zod.
  '@typescript-eslint/no-explicit-any':'off',
  '@typescript-eslint/no-unused-vars':['error',{argsIgnorePattern:'^_',varsIgnorePattern:'^_',caughtErrors:'none'}],
 }},
);
