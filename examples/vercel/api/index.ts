import { vercelAdapter } from 'lacis/adapters'
import { routes, middlewares } from '../routes/_manifest.js'

export default vercelAdapter.createHandler({ routes, middlewares })
