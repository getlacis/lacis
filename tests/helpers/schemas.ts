export function okSchema<T>(fn?: (v: unknown) => T) {
  return {
    '~standard': {
      version: 1 as const,
      vendor: 'test',
      validate: (value: unknown) => ({ value: (fn ? fn(value) : value) as T }),
      types: undefined as any,
    },
  }
}

export function failSchema(message: string) {
  return {
    '~standard': {
      version: 1 as const,
      vendor: 'test',
      validate: (_: unknown) => ({ issues: [{ message }] }),
      types: undefined as any,
    },
  }
}

export function asyncOkSchema<T>() {
  return {
    '~standard': {
      version: 1 as const,
      vendor: 'test',
      validate: async (value: unknown) => ({ value: value as T }),
      types: undefined as any,
    },
  }
}
