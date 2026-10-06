/** Registers the test resolver hooks. Load with `node --import ./test/stubs/register.mjs`. */
import { register } from 'node:module'

register(new URL('./hooks.mjs', import.meta.url))
