const ESM_PACKAGES = ['arktype', '@ark/schema', '@ark/util', 'arkregex']
const transformIgnorePatterns = [`/node_modules/(?!(${ESM_PACKAGES.join('|')})/)`]
const babelTransform = ['babel-jest', { presets: [['@babel/preset-env', { targets: { node: 'current' } }]] }]
const transform = {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: './tsconfig.test.json' }],
    '^.+\\.m?js$': babelTransform,
}

module.exports = {
    testEnvironment: 'node',
    moduleNameMapper: {
        '^@core/(.*)$': '<rootDir>/src/core/$1',
        '^@/(.*)$': '<rootDir>/src/$1',
        '^(\\.{1,2}/.*)\\.js$': '$1'
    },
    transformIgnorePatterns,
    projects: [
        {
            displayName: 'unit',
            testEnvironment: 'node',
            testMatch: ['<rootDir>/tests/**/*.test.ts'],
            testPathIgnorePatterns: ['<rootDir>/tests/integration/'],
            transform,
            moduleNameMapper: {
                '^@core/(.*)$': '<rootDir>/src/core/$1',
                '^@/(.*)$': '<rootDir>/src/$1',
                '^(\\.{1,2}/.*)\\.js$': '$1'
            },
            transformIgnorePatterns,
        },
        {
            displayName: 'integration',
            testEnvironment: 'node',
            testMatch: ['<rootDir>/tests/integration/**/*.integration.test.ts'],
            transform,
            moduleNameMapper: {
                '^@core/(.*)$': '<rootDir>/src/core/$1',
                '^@/(.*)$': '<rootDir>/src/$1',
                '^(\\.{1,2}/.*)\\.js$': '$1'
            },
            transformIgnorePatterns,
        }
    ]
};