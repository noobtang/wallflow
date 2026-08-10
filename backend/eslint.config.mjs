import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'migrations/'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      // 下划线前缀 = 有意不使用的参数/变量(接口强制签名但实现不需要的场景,如 mock)
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
