import { cloudflareAdapter } from 'lacis/adapters'
import { routes } from './routes/_manifest.js'

export default cloudflareAdapter.createHandler({ routes })
