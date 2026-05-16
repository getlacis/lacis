import { netlifyAdapter } from 'lacis/adapters'
import { routes } from '../../routes/_manifest.js'

const handler = netlifyAdapter.createHandler({ routes }) as Function

export { handler }
