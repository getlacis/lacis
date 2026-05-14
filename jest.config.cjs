module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    globals: {
        'ts-jest': {
            tsconfig: './tsconfig.test.json'
        }
    },
    moduleNameMapper: {
        '^@core/(.*)$': '<rootDir>/src/core/$1',
        '^@/(.*)$': '<rootDir>/src/$1',
        '^(\\.{1,2}/.*)\\.js$': '$1'
    },
    projects: [
        {
            displayName: 'unit',
            preset: 'ts-jest',
            testEnvironment: 'node',
            testMatch: ['<rootDir>/tests/**/*.test.ts'],
            testPathIgnorePatterns: ['<rootDir>/tests/integration/'],
            globals: { 'ts-jest': { tsconfig: './tsconfig.test.json' } },
            moduleNameMapper: {
                '^@core/(.*)$': '<rootDir>/src/core/$1',
                '^@/(.*)$': '<rootDir>/src/$1',
                '^(\\.{1,2}/.*)\\.js$': '$1'
            }
        },
        {
            displayName: 'integration',
            preset: 'ts-jest',
            testEnvironment: 'node',
            testMatch: ['<rootDir>/tests/integration/**/*.integration.test.ts'],
            globals: { 'ts-jest': { tsconfig: './tsconfig.test.json' } },
            moduleNameMapper: {
                '^@core/(.*)$': '<rootDir>/src/core/$1',
                '^@/(.*)$': '<rootDir>/src/$1',
                '^(\\.{1,2}/.*)\\.js$': '$1'
            }
        }
    ]
};