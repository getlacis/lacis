import { netlifyAdapter } from 'lacis/adapters'
import { routes, middlewares } from '../../routes/_manifest.js'

const handler = netlifyAdapter.createHandler({ routes, middlewares }) as Function

export { handler }
