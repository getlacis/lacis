import { netlifyAdapter } from 'zeno/adapters'
import { routes } from '../../routes/_manifest.js'

export const handler = netlifyAdapter.createHandler({ routes }) as Function
