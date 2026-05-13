import { netlifyAdapter } from 'zeno/adapters'
import { routes } from '../../routes/_manifest.js'

const handler = netlifyAdapter.createHandler({ routes }) as Function

export { handler }
