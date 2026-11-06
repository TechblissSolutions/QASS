import type { Config } from 'jest';

const config: Config = {
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/tests'],
  transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: { jsx: 'react-jsx' } }] },
  moduleNameMapper: {
    '\\.(css|less|scss|sass)$': '<rootDir>/tests/__mocks__/styleMock.js',
    '^@/(.*)$': '<rootDir>/$1',
    '^server-only$': '<rootDir>/tests/__mocks__/server-only.js',
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  clearMocks: true,
  testPathIgnorePatterns: ['/node_modules/', '/.next/'],
};

export default config;
