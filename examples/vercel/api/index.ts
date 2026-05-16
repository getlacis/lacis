import { vercelAdapter } from 'lacis/adapters'
import { routes } from '../routes/_manifest.js'

export default vercelAdapter.createHandler({ routes })
