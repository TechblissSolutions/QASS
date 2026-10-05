import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/tests'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1', '^server-only$': '<rootDir>/tests/__mocks__/server-only.js' },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  clearMocks: true,
  testPathIgnorePatterns: ['/node_modules/', '/.next/'],
};

export default config;
